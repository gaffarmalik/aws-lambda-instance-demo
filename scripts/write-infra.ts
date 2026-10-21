// Generate portable CloudFormation JSON with explicit bucket names to avoid the
// S3 notification -> Lambda permission -> bucket dependency cycle.
import { writeFileSync } from "node:fs";
const ref = (name: string) => ({ Ref: name });
const sub = (text: string) => ({ "Fn::Sub": text });
const arn = (name: string) => ({ "Fn::GetAtt": [name, "Arn"] });
const trust = {
  Version: "2012-10-17",
  Statement: [
    {
      Effect: "Allow",
      Principal: { Service: "lambda.amazonaws.com" },
      Action: "sts:AssumeRole",
    },
  ],
};
const policy = (Statement: Record<string, unknown>[]) => ({
  Version: "2012-10-17",
  Statement,
});
const allow = (
  Action: string[],
  Resource: unknown,
  rest: Record<string, unknown> = {},
) => ({
  Effect: "Allow",
  Action,
  Resource,
  ...rest,
});
const bucketArn = sub("arn:${AWS::Partition}:s3:::${BucketName}");
const objectArns = (prefixes: string[]) =>
  prefixes.map((prefix) =>
    sub(`arn:\${AWS::Partition}:s3:::\${BucketName}/${prefix}/*`),
  );
// Also required for GetObject to return 404 on a not-yet-created result/status.
const list = allow(["s3:ListBucket"], bucketArn);
const models = ref("BedrockResourceArns");
const template = {
  AWSTemplateFormatVersion: "2010-09-09",
  Description:
    "Branchlight demo: S3 batches invoke a published Lambda Managed Instances worker. Express stays local.",
  Parameters: {
    BucketName: {
      Type: "String",
      Description: "Globally unique NEW feedback bucket name",
      AllowedPattern: "[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]",
    },
    ArtifactBucket: {
      Type: "String",
      Description: "Existing deployment artifact bucket in this region",
    },
    ArtifactKey: {
      Type: "String",
      Description: "Unique key of the worker zip; change for every release",
    },
    CodeSha256: {
      Type: "String",
      Description:
        "Base64 SHA256 of the worker zip (used to publish a fresh version)",
    },
    SubnetIds: {
      Type: "List<AWS::EC2::Subnet::Id>",
      Description:
        "Subnets in one VPC with AWS service connectivity; use multiple AZs",
    },
    SecurityGroupIds: {
      Type: "List<AWS::EC2::SecurityGroup::Id>",
      Description:
        "Security groups in the same VPC; permit required outbound HTTPS",
    },
    BedrockModelId: {
      Type: "String",
      Description: "Enabled Converse model ID or inference profile ID",
    },
    BedrockResourceArns: {
      Type: "CommaDelimitedList",
      Description:
        "Exact model ARNs, plus inference-profile and destination model ARNs if using a cross-region profile",
    },
    MaxVCpuCount: {
      Type: "Number",
      Default: 24,
      MinValue: 8,
      Description:
        "Capacity limit; managed EC2 instances incur charges while provisioned",
    },
  },
  Resources: {
    OperatorRole: {
      Type: "AWS::IAM::Role",
      Properties: {
        AssumeRolePolicyDocument: trust,
        ManagedPolicyArns: [
          sub(
            "arn:${AWS::Partition}:iam::aws:policy/AWSLambdaManagedEC2ResourceOperator",
          ),
        ],
      },
    },
    CapacityProvider: {
      Type: "AWS::Lambda::CapacityProvider",
      Properties: {
        VpcConfig: {
          SubnetIds: ref("SubnetIds"),
          SecurityGroupIds: ref("SecurityGroupIds"),
        },
        PermissionsConfig: {
          CapacityProviderOperatorRoleArn: arn("OperatorRole"),
        },
        InstanceRequirements: { Architectures: ["x86_64"] },
        CapacityProviderScalingConfig: {
          ScalingMode: "Auto",
          MaxVCpuCount: ref("MaxVCpuCount"),
        },
      },
    },
    FailureQueue: {
      Type: "AWS::SQS::Queue",
      Properties: {
        MessageRetentionPeriod: 1209600,
        SqsManagedSseEnabled: true,
      },
    },
    WorkerRole: {
      Type: "AWS::IAM::Role",
      Properties: {
        AssumeRolePolicyDocument: trust,
        ManagedPolicyArns: [
          sub(
            "arn:${AWS::Partition}:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole",
          ),
        ],
        Policies: [
          {
            PolicyName: "BatchProcessing",
            PolicyDocument: policy([
              list,
              allow(
                ["s3:GetObject"],
                objectArns(["batches", "status", "processed"]),
              ),
              allow(["s3:PutObject"], objectArns(["status", "processed"])),
              allow(["bedrock:InvokeModel"], models),
              allow(["sqs:SendMessage"], arn("FailureQueue")),
            ]),
          },
        ],
      },
    },
    Worker: {
      Type: "AWS::Lambda::Function",
      Properties: {
        Description:
          "Separate batch worker: classification, aggregation, transformation",
        Runtime: "nodejs22.x",
        Handler: "index.handler",
        Architectures: ["x86_64"],
        MemorySize: 2048,
        Timeout: 900,
        Role: arn("WorkerRole"),
        Code: { S3Bucket: ref("ArtifactBucket"), S3Key: ref("ArtifactKey") },
        CapacityProviderConfig: {
          LambdaManagedInstancesCapacityProviderConfig: {
            CapacityProviderArn: arn("CapacityProvider"),
            ExecutionEnvironmentMemoryGiBPerVCpu: 4,
            PerExecutionEnvironmentMaxConcurrency: 4,
          },
        },
        Environment: {
          Variables: {
            DEMO_MODE: "aws",
            S3_BUCKET: ref("BucketName"),
            BEDROCK_MODEL_ID: ref("BedrockModelId"),
            MODEL_REQUEST_SIZE: "10",
          },
        },
        DeadLetterConfig: { TargetArn: arn("FailureQueue") },
      },
    },
    WorkerVersion: {
      Type: "AWS::Lambda::Version",
      Properties: {
        FunctionName: ref("Worker"),
        CodeSha256: ref("CodeSha256"),
      },
    },
    WorkerAlias: {
      Type: "AWS::Lambda::Alias",
      Properties: {
        Name: "live",
        FunctionName: ref("Worker"),
        FunctionVersion: { "Fn::GetAtt": ["WorkerVersion", "Version"] },
      },
    },
    AsyncRetries: {
      Type: "AWS::Lambda::EventInvokeConfig",
      Properties: {
        FunctionName: ref("Worker"),
        Qualifier: "live",
        MaximumRetryAttempts: 2,
        MaximumEventAgeInSeconds: 21600,
      },
      DependsOn: "WorkerAlias",
    },
    S3InvokePermission: {
      Type: "AWS::Lambda::Permission",
      Properties: {
        Action: "lambda:InvokeFunction",
        FunctionName: ref("WorkerAlias"),
        Principal: "s3.amazonaws.com",
        SourceAccount: ref("AWS::AccountId"),
        SourceArn: bucketArn,
      },
    },
    FeedbackBucket: {
      Type: "AWS::S3::Bucket",
      DependsOn: "S3InvokePermission",
      DeletionPolicy: "Retain",
      UpdateReplacePolicy: "Retain",
      Properties: {
        BucketName: ref("BucketName"),
        BucketEncryption: {
          ServerSideEncryptionConfiguration: [
            { ServerSideEncryptionByDefault: { SSEAlgorithm: "AES256" } },
          ],
        },
        PublicAccessBlockConfiguration: {
          BlockPublicAcls: true,
          BlockPublicPolicy: true,
          IgnorePublicAcls: true,
          RestrictPublicBuckets: true,
        },
        NotificationConfiguration: {
          LambdaConfigurations: [
            {
              Event: "s3:ObjectCreated:*",
              Function: ref("WorkerAlias"),
              Filter: {
                S3Key: {
                  Rules: [
                    { Name: "prefix", Value: "batches/" },
                    { Name: "suffix", Value: ".json" },
                  ],
                },
              },
            },
          ],
        },
      },
    },
    BucketPolicy: {
      Type: "AWS::S3::BucketPolicy",
      Properties: {
        Bucket: ref("FeedbackBucket"),
        PolicyDocument: policy([
          {
            Effect: "Deny",
            Principal: "*",
            Action: "s3:*",
            Resource: [
              bucketArn,
              sub("arn:${AWS::Partition}:s3:::${BucketName}/*"),
            ],
            Condition: { Bool: { "aws:SecureTransport": "false" } },
          },
        ]),
      },
    },
    CollectorPolicy: {
      Type: "AWS::IAM::ManagedPolicy",
      Properties: {
        Description:
          "Attach to the local workshop operator role, never to the browser",
        PolicyDocument: policy([
          list,
          allow(
            ["s3:GetObject"],
            objectArns(["batches", "status", "processed", "reports"]),
          ),
          allow(["s3:PutObject"], objectArns(["batches", "reports"])),
          allow(["bedrock:InvokeModel"], models),
        ]),
      },
    },
  },
  Outputs: {
    Bucket: { Value: ref("FeedbackBucket") },
    WorkerAliasArn: { Value: ref("WorkerAlias") },
    CapacityProviderArn: { Value: arn("CapacityProvider") },
    CollectorPolicyArn: { Value: ref("CollectorPolicy") },
    FailureQueueUrl: { Value: ref("FailureQueue") },
  },
};
writeFileSync("infra/template.json", JSON.stringify(template, null, 2) + "\n");
console.log("Wrote infra/template.json");
