# Deploy the AWS portion

This stack provisions real AWS resources and incurs charges. Express remains a single local process; only the independent worker is deployed. Use a dedicated workshop stack and bucket.

## Prerequisites

1. A current AWS CLI v2 and a profile/SSO session authorized to create S3, Lambda, Lambda capacity providers, IAM roles/policies, CloudWatch Logs and SQS resources, and to pass the two Lambda roles. Creating the first capacity provider in an account can also require `iam:CreateServiceLinkedRole`.
2. A region supporting Lambda Managed Instances and your chosen Bedrock model. Node.js 22 is a supported Managed Instances runtime. See [supported runtimes](https://docs.aws.amazon.com/lambda/latest/dg/lambda-managed-instances-runtimes.html) and [getting started](https://docs.aws.amazon.com/lambda/latest/dg/lambda-managed-instances-getting-started.html).
3. Existing subnets and security groups in **one VPC**, ideally across multiple Availability Zones. They need connectivity to S3, Bedrock Runtime, and telemetry services such as CloudWatch Logs. Use configured private subnets with NAT or appropriate VPC endpoints and DNS. The stack accepts these resources; it does not create networking. See [networking for Managed Instances](https://docs.aws.amazon.com/lambda/latest/dg/lambda-managed-instances-networking.html).
4. An existing artifact bucket in the deployment region, used only to stage the worker zip.
5. An enabled Converse-compatible Bedrock model ID or inference profile. Supply its exact allowed resource ARNs. For cross-region inference, include the inference profile ARN and all required destination foundation-model ARNs. Check your account's model access, quotas, marketplace subscription requirements if applicable, and IAM/SCP permissions. See the [Bedrock Converse API](https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_Converse.html).

Choose your values before running the commands below; placeholder names are deliberately nonfunctional. Use your selected AWS profile throughout, for example by setting `AWS_PROFILE` in your terminal. Do not put credentials into React or committed files.

## Package and create the stack

From the repository root:

```sh
npm ci
npm run package:worker
```

This builds a self-contained `dist/worker.zip` containing `index.mjs` and its source map. Dependencies are bundled; Lambda's handler is `index.handler`. `dist/worker-sha256.txt` contains the base64 SHA256 of the exact zip.

Upload the zip with a **new artifact key for each release**:

```sh
aws s3 cp dist/worker.zip s3://YOUR_ARTIFACT_BUCKET/branchlight/worker-RELEASE.zip --region YOUR_REGION
cp infra/parameters.example.json infra/parameters.local.json
```

Edit `infra/parameters.local.json`: new globally unique feedback bucket name, artifact bucket/key, the generated SHA256, subnet IDs, security group IDs, Bedrock model/profile ID, and model/profile resource ARNs. The feedback bucket must not already exist: CloudFormation creates it and owns its notification configuration.

```sh
aws cloudformation validate-template --template-body file://infra/template.json --region YOUR_REGION
aws cloudformation create-stack \
  --stack-name branchlight-demo \
  --template-body file://infra/template.json \
  --parameters file://infra/parameters.local.json \
  --capabilities CAPABILITY_IAM \
  --region YOUR_REGION
aws cloudformation wait stack-create-complete --stack-name branchlight-demo --region YOUR_REGION
aws cloudformation describe-stacks --stack-name branchlight-demo --query 'Stacks[0].Outputs' --region YOUR_REGION
```

If creation fails, inspect stack events. Do not switch the function to standard Lambda to work around capacity-provider prerequisites: that would change the demonstration.

For an update, rebuild and upload under a new artifact key, update both `ArtifactKey` and `CodeSha256`, then run `aws cloudformation update-stack` with the same arguments. The SHA256 change replaces the published `AWS::Lambda::Version` and moves the `live` alias to that version. The version resource depends on the function; code is updated before publication. See [function capacity-provider configuration](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-properties-lambda-function-capacityproviderconfig.html) and [version publication](https://docs.aws.amazon.com/lambda/latest/dg/lambda-managed-instances-getting-started.html).

`template.json` is committed and ready to parameterize. Its maintainable generator is `scripts/write-infra.ts`; run `npm run infra:generate` after editing that generator.

## Connect the local app

The stack outputs `Bucket`, `WorkerAliasArn`, `CapacityProviderArn`, `CollectorPolicyArn`, and `FailureQueueUrl`.

Have the workshop operator's AWS role/profile granted the generated **CollectorPolicyArn**. It permits listing/reading this demo's objects, writing `batches/` and `reports/`, and invoking only the supplied model resources. The Lambda worker has a separate execution role that can read batches and write `status/` and `processed/`. Both need bucket-list permission so S3 returns 404 rather than 403 for not-yet-created result objects; see [S3 GetObject permission behavior](https://docs.aws.amazon.com/AmazonS3/latest/API/API_GetObject.html).

Set these values in the root `.env`:

```dotenv
DEMO_MODE=aws
AWS_REGION=YOUR_REGION
S3_BUCKET=YOUR_FEEDBACK_BUCKET
BEDROCK_MODEL_ID=YOUR_ENABLED_MODEL_OR_PROFILE_ID
MODEL_REQUEST_SIZE=10
```

Then:

```sh
npm run dev:aws
```

The SDK uses its normal credential chain, including `AWS_PROFILE`. The browser sends requests only to Express. No collection feedback goes to Bedrock until a batch has been uploaded and S3 invokes the worker.

## Verify the real integration

1. Confirm the function's capacity provider is active, its published version is active, and the `live` alias points to that version. It must be a Managed Instances function, not a conventional function with a similar name.
2. Check the feedback bucket notification: exactly `s3:ObjectCreated:*`, prefix `batches/`, suffix `.json`, target `WorkerAliasArn`. The stack grants S3 invoke permission with both source bucket ARN and account restriction.
3. Add sample feedback and flush once. Verify one source JSON object, then `status/<batch-id>.json` and `processed/<batch-id>.json` in S3. Confirm the processed object names the configured Bedrock model and `feedback-classification-v1`.
4. Inspect `responseCount`, `ratingTotal`, regional/branch/topic counts, individual IDs, exact excerpts, and source references. Ask a question and confirm an explanation-versioned report under `reports/`.
5. Invoke the same source event again. Verify the result reports a duplicate and the dashboard count does not increase. Writes to `status/`, `processed/`, and `reports/` must not invoke the worker.

A worker attempt downloads one original batch. Retries can download it again; simultaneous duplicate attempts can both call the model. Conditional output creation prevents duplicate stored metrics.

## Retry a failed batch

Failed classification or storage operations are rethrown, allowing Lambda's configured two asynchronous retries. Exhausted events go to the encrypted SQS dead-letter queue. Inspect the error in the status object and CloudWatch, fix IAM/network/model access or reduce request size, and replay the original event.

Create a local `retry-event.json` with the **exact existing source key** (do not edit or upload the batch under a new ID):

```json
{
  "Records": [
    {
      "eventSource": "aws:s3",
      "eventName": "ObjectCreated:Put",
      "s3": {
        "bucket": { "name": "YOUR_FEEDBACK_BUCKET" },
        "object": { "key": "batches/2026-10-19/13-00/batch-EXISTING_UUID.json" }
      }
    }
  ]
}
```

```sh
aws lambda invoke \
  --function-name YOUR_WORKER_ALIAS_ARN \
  --invocation-type Event \
  --cli-binary-format raw-in-base64-out \
  --payload file://retry-event.json \
  --region YOUR_REGION \
  /tmp/branchlight-replay-response.json
```

Read the status/output again afterward. A 202 response only means Lambda accepted the invocation. A completed batch will short-circuit safely. A terminated worker may leave a processing status; the dashboard keeps that batch pending until a replay completes it. Conditional completion repairs a crash between result creation and status finalization.

## Cleanup after the workshop

Stop the local app. Delete the workshop stack when its compute is no longer needed:

```sh
aws cloudformation delete-stack --stack-name branchlight-demo --region YOUR_REGION
aws cloudformation wait stack-delete-complete --stack-name branchlight-demo --region YOUR_REGION
```

The feedback bucket intentionally has **Retain** policies to preserve feedback and reports. The artifact bucket is external to the stack. Review and remove those retained objects/buckets separately if no longer needed. Because the retained feedback bucket keeps its notification configuration, remove that notification before reusing the bucket after stack deletion. Review any retained worker log groups as well.

Managed Instances use provisioned EC2 capacity; there is no assumption of a cost advantage for this intermittent demo. See [Managed Instances behavior](https://docs.aws.amazon.com/lambda/latest/dg/lambda-managed-instances.html). Deploying the template and testing it against your actual model/account are separate from the repository's local tests.
