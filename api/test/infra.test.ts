import test from "node:test";
import assert from "node:assert/strict";
import template from "../../infra/template.json" with { type: "json" };

test("deployment graph has no circular dependencies and routes only batch events to a published Managed Instances worker", () => {
  const resources = template.Resources,
    parameters = template.Parameters;
  function references(value: unknown): string[] {
    if (!value || typeof value !== "object") return [];
    if ("Ref" in value && typeof value.Ref === "string") return [value.Ref];
    if (
      "Fn::GetAtt" in value &&
      Array.isArray(value["Fn::GetAtt"]) &&
      typeof value["Fn::GetAtt"][0] === "string"
    )
      return [value["Fn::GetAtt"][0]];
    if ("Fn::Sub" in value && typeof value["Fn::Sub"] === "string")
      return [...value["Fn::Sub"].matchAll(/\$\{([^}.]+)(?:\.[^}]+)?\}/g)].map(
        (match) => match[1],
      );
    return Object.values(value).flatMap(references);
  }
  const graph: Record<string, string[]> = {};
  for (const [name, resource] of Object.entries(resources)) {
    const refs = [
      ...references(resource),
      ...["DependsOn" in resource ? resource.DependsOn : []].flat(),
    ];
    for (const dependency of refs)
      assert.ok(
        dependency in resources ||
          dependency in parameters ||
          dependency.startsWith("AWS::"),
        `Unknown reference: ${dependency}`,
      );
    graph[name] = refs.filter((name) => name in resources);
  }
  function walk(name: string, path: string[] = []) {
    assert.ok(
      !path.includes(name),
      `Circular dependency: ${[...path, name].join(" -> ")}`,
    );
    graph[name].forEach((next) => walk(next, [...path, name]));
  }
  Object.keys(graph).forEach((name) => walk(name));
  assert.equal(
    resources.Worker.Properties.CapacityProviderConfig
      .LambdaManagedInstancesCapacityProviderConfig.CapacityProviderArn[
      "Fn::GetAtt"
    ][0],
    "CapacityProvider",
  );
  assert.equal(
    resources.WorkerAlias.Properties.FunctionVersion["Fn::GetAtt"][0],
    "WorkerVersion",
  );
  const notifications =
    resources.FeedbackBucket.Properties.NotificationConfiguration
      .LambdaConfigurations;
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0].Function.Ref, "WorkerAlias");
  assert.deepEqual(notifications[0].Filter.S3Key.Rules, [
    { Name: "prefix", Value: "batches/" },
    { Name: "suffix", Value: ".json" },
  ]);
  assert.equal(
    resources.S3InvokePermission.Properties.FunctionName.Ref,
    "WorkerAlias",
  );
  assert.ok(
    resources.WorkerRole.Properties.Policies[0].PolicyDocument.Statement.some(
      (s) => s.Action.includes("s3:ListBucket"),
    ),
  );
  assert.equal(
    resources.Worker.Properties.Environment.Variables.DEMO_MODE,
    "aws",
  );
});
