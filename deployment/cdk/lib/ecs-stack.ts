import * as cdk from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as ecr_assets from "aws-cdk-lib/aws-ecr-assets";
import * as elbv2 from "aws-cdk-lib/aws-elasticloadbalancingv2";
import * as logs from "aws-cdk-lib/aws-logs";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import * as iam from "aws-cdk-lib/aws-iam";
import { Construct } from "constructs";

export interface SupersetEcsStackProps extends cdk.StackProps {
  vpc: ec2.IVpc;
  dbSecret: secretsmanager.ISecret;
  rdsEndpoint: string;
  rdsPort: string;
  redisEndpoint: string;
  redisPort: string;
  dbSecurityGroup: ec2.ISecurityGroup;
  redisSecurityGroup: ec2.ISecurityGroup;
}

export class SupersetEcsStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: SupersetEcsStackProps) {
    super(scope, id, props);

    // ---------------------------------------------------------------
    // Context values (pass via cdk.json or -c flag)
    // ---------------------------------------------------------------
    const cognitoDomain = this.node.tryGetContext("cognitoDomain") ?? "CHANGE_ME";
    const cognitoClientId = this.node.tryGetContext("cognitoClientId") ?? "CHANGE_ME";
    const cognitoUserPoolId = this.node.tryGetContext("cognitoUserPoolId") ?? "CHANGE_ME";
    const cognitoRegion = this.node.tryGetContext("cognitoRegion") ?? this.region;
    const supersetPublicUrl =
      this.node.tryGetContext("supersetPublicUrl") ?? "https://superset.example.com";

    // Snowflake connection (optional — set snowflakeAccount to enable)
    const snowflakeAccount = this.node.tryGetContext("snowflakeAccount") ?? "";
    const snowflakeUser = this.node.tryGetContext("snowflakeUser") ?? "";
    const snowflakeDatabase = this.node.tryGetContext("snowflakeDatabase") ?? "";
    const snowflakeSchema = this.node.tryGetContext("snowflakeSchema") ?? "PUBLIC";
    const snowflakeWarehouse = this.node.tryGetContext("snowflakeWarehouse") ?? "";
    const snowflakeRole = this.node.tryGetContext("snowflakeRole") ?? "";

    // ---------------------------------------------------------------
    // Secrets
    // ---------------------------------------------------------------
    const supersetSecretKey = secretsmanager.Secret.fromSecretNameV2(
      this,
      "SupersetSecretKey",
      "superset/secret-key"
    );

    const cognitoClientSecret = new secretsmanager.Secret(
      this,
      "CognitoClientSecret",
      {
        secretName: "superset/cognito-client-secret",
        description: "Cognito app client secret for Superset OIDC",
      }
    );

    // Snowflake key-pair auth: private key stored in Secrets Manager
    const snowflakePrivateKey = new secretsmanager.Secret(
      this,
      "SnowflakePrivateKey",
      {
        secretName: "superset/snowflake-private-key",
        description:
          "PEM-encoded PKCS8 private key for Snowflake key-pair authentication",
      }
    );

    // ---------------------------------------------------------------
    // Docker image (built from repo root)
    // ---------------------------------------------------------------
    const image = new ecr_assets.DockerImageAsset(this, "SupersetImage", {
      directory: "../../", // repo root
      file: "deployment/Dockerfile",
      platform: ecr_assets.Platform.LINUX_AMD64,
      exclude: ["deployment/cdk/cdk.out", "deployment/cdk/node_modules"],
      buildArgs: {
        BUILD_TRANSLATIONS: "true",
      },
    });

    // ---------------------------------------------------------------
    // ECS Cluster
    // ---------------------------------------------------------------
    const cluster = new ecs.Cluster(this, "SupersetCluster", {
      vpc: props.vpc,
      containerInsights: true,
    });

    // ---------------------------------------------------------------
    // Shared log group
    // ---------------------------------------------------------------
    const logGroup = new logs.LogGroup(this, "SupersetLogs", {
      logGroupName: "/ecs/superset",
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // ---------------------------------------------------------------
    // Task execution role (pull images, read secrets)
    // ---------------------------------------------------------------
    const executionRole = new iam.Role(this, "TaskExecRole", {
      assumedBy: new iam.ServicePrincipal("ecs-tasks.amazonaws.com"),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName(
          "service-role/AmazonECSTaskExecutionRolePolicy"
        ),
      ],
    });
    supersetSecretKey.grantRead(executionRole);
    props.dbSecret.grantRead(executionRole);
    cognitoClientSecret.grantRead(executionRole);

    // ---------------------------------------------------------------
    // Task role (runtime permissions)
    // ---------------------------------------------------------------
    const taskRole = new iam.Role(this, "TaskRole", {
      assumedBy: new iam.ServicePrincipal("ecs-tasks.amazonaws.com"),
    });

    // ---------------------------------------------------------------
    // Security group for ECS tasks
    // ---------------------------------------------------------------
    const ecsSg = new ec2.SecurityGroup(this, "EcsSg", {
      vpc: props.vpc,
      description: "Superset ECS tasks",
      allowAllOutbound: true,
    });

    // Allow ECS → RDS (standalone ingress to avoid cross-stack cycle)
    new ec2.CfnSecurityGroupIngress(this, "EcsToRds", {
      ipProtocol: "tcp",
      fromPort: cdk.Token.asNumber(props.rdsPort),
      toPort: cdk.Token.asNumber(props.rdsPort),
      groupId: props.dbSecurityGroup.securityGroupId,
      sourceSecurityGroupId: ecsSg.securityGroupId,
      description: "ECS to RDS",
    });

    // Allow ECS → Redis (standalone ingress to avoid cross-stack cycle)
    new ec2.CfnSecurityGroupIngress(this, "EcsToRedis", {
      ipProtocol: "tcp",
      fromPort: cdk.Token.asNumber(props.redisPort),
      toPort: cdk.Token.asNumber(props.redisPort),
      groupId: props.redisSecurityGroup.securityGroupId,
      sourceSecurityGroupId: ecsSg.securityGroupId,
      description: "ECS to Redis",
    });

    // ---------------------------------------------------------------
    // Shared environment variables & secrets
    // ---------------------------------------------------------------
    const sharedEnv: Record<string, string> = {
      SUPERSET_ENV: "production",
      SUPERSET_PORT: "8088",
      SUPERSET_LOG_LEVEL: "INFO",
      SUPERSET_LOAD_EXAMPLES: "no",
      COGNITO_DOMAIN: cognitoDomain,
      COGNITO_CLIENT_ID: cognitoClientId,
      COGNITO_USER_POOL_ID: cognitoUserPoolId,
      COGNITO_REGION: cognitoRegion,
      SUPERSET_PUBLIC_URL: supersetPublicUrl,
      REDIS_URL: `redis://${props.redisEndpoint}:${props.redisPort}`,
      // Snowflake connection details (bootstrap skips if SNOWFLAKE_ACCOUNT is empty)
      SNOWFLAKE_ACCOUNT: snowflakeAccount,
      SNOWFLAKE_USER: snowflakeUser,
      SNOWFLAKE_DATABASE: snowflakeDatabase,
      SNOWFLAKE_SCHEMA: snowflakeSchema,
      SNOWFLAKE_WAREHOUSE: snowflakeWarehouse,
      SNOWFLAKE_ROLE: snowflakeRole,
    };

    const sharedSecrets: Record<string, ecs.Secret> = {
      SECRET_KEY: ecs.Secret.fromSecretsManager(supersetSecretKey),
      DATABASE_URL: ecs.Secret.fromSecretsManager(props.dbSecret, "url"),
      COGNITO_CLIENT_SECRET: ecs.Secret.fromSecretsManager(cognitoClientSecret),
      SNOWFLAKE_PRIVATE_KEY: ecs.Secret.fromSecretsManager(snowflakePrivateKey),
    };

    // Helper to build the DATABASE_URL from RDS secret fields
    // Since RDS secret doesn't have a pre-built "url" field, we construct it
    const dbUrl = `postgresql+psycopg2://\${DB_USER}:\${DB_PASS}@${props.rdsEndpoint}:${props.rdsPort}/superset`;

    // Override DATABASE_URL: use individual secret fields to construct it
    delete sharedSecrets["DATABASE_URL"];
    const dbSecrets: Record<string, ecs.Secret> = {
      DB_USER: ecs.Secret.fromSecretsManager(props.dbSecret, "username"),
      DB_PASS: ecs.Secret.fromSecretsManager(props.dbSecret, "password"),
    };

    // We'll pass DATABASE_URL via the config that reads env vars
    // Update: superset_config.py reads DATABASE_URL directly, so let's set it in the container
    // The cleanest approach: override in superset_config.py to construct from parts
    // For simplicity, we pass individual parts and construct in config
    sharedEnv["DATABASE_HOST"] = props.rdsEndpoint;
    sharedEnv["DATABASE_PORT"] = props.rdsPort;
    sharedEnv["DATABASE_DB"] = "superset";

    // ---------------------------------------------------------------
    // Web service (Superset app + gunicorn)
    // ---------------------------------------------------------------
    const webTaskDef = new ecs.FargateTaskDefinition(this, "WebTaskDef", {
      memoryLimitMiB: 4096,
      cpu: 2048,
      executionRole,
      taskRole,
    });

    webTaskDef.addContainer("superset-web", {
      image: ecs.ContainerImage.fromDockerImageAsset(image),
      logging: ecs.LogDrivers.awsLogs({ logGroup, streamPrefix: "web" }),
      environment: {
        ...sharedEnv,
        SERVER_WORKER_AMOUNT: "4",
        GUNICORN_TIMEOUT: "120",
      },
      secrets: {
        ...sharedSecrets,
        ...dbSecrets,
      },
      portMappings: [{ containerPort: 8088, protocol: ecs.Protocol.TCP }],
      healthCheck: {
        command: ["CMD-SHELL", "curl -f http://localhost:8088/health || exit 1"],
        interval: cdk.Duration.seconds(30),
        timeout: cdk.Duration.seconds(10),
        retries: 3,
        startPeriod: cdk.Duration.seconds(60),
      },
    });

    const webService = new ecs.FargateService(this, "WebService", {
      cluster,
      taskDefinition: webTaskDef,
      desiredCount: 2,
      securityGroups: [ecsSg],
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      circuitBreaker: { enable: true, rollback: true },
      enableExecuteCommand: true, // For debugging via `aws ecs execute-command`
    });

    // ---------------------------------------------------------------
    // Application Load Balancer (CloudFront-only access)
    // ---------------------------------------------------------------
    const alb = new elbv2.ApplicationLoadBalancer(this, "SupersetAlb", {
      vpc: props.vpc,
      internetFacing: true, // Must be internet-facing for CloudFront origin
    });

    // Restrict ALB to CloudFront traffic only using the AWS managed prefix list.
    // This prevents direct access to the ALB, bypassing CloudFront.
    const albSg = alb.connections.securityGroups[0];
    // Remove the default "allow all" ingress rule by adding only CloudFront
    albSg.addIngressRule(
      ec2.Peer.prefixList(
        // AWS-managed prefix list for CloudFront origin-facing IPs
        // Look up the ID: aws ec2 describe-managed-prefix-lists --filters Name=prefix-list-name,Values=com.amazonaws.global.cloudfront.origin-facing
        this.node.tryGetContext("cloudfrontPrefixListId") ?? "pl-b6a144df" // us-east-2 default
      ),
      ec2.Port.tcp(80),
      "Allow inbound from CloudFront only"
    );

    const listener = alb.addListener("HttpListener", {
      port: 80,
      protocol: elbv2.ApplicationProtocol.HTTP,
      open: false, // Do not auto-add 0.0.0.0/0 ingress
    });

    listener.addTargets("WebTarget", {
      port: 8088,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targets: [webService],
      healthCheck: {
        path: "/health",
        interval: cdk.Duration.seconds(30),
        healthyThresholdCount: 2,
        unhealthyThresholdCount: 3,
      },
      deregistrationDelay: cdk.Duration.seconds(30),
    });

    // ---------------------------------------------------------------
    // Celery worker service
    // ---------------------------------------------------------------
    const workerTaskDef = new ecs.FargateTaskDefinition(this, "WorkerTaskDef", {
      memoryLimitMiB: 4096,
      cpu: 1024,
      executionRole,
      taskRole,
    });

    workerTaskDef.addContainer("superset-worker", {
      image: ecs.ContainerImage.fromDockerImageAsset(image),
      logging: ecs.LogDrivers.awsLogs({ logGroup, streamPrefix: "worker" }),
      environment: sharedEnv,
      secrets: { ...sharedSecrets, ...dbSecrets },
      command: [
        "celery",
        "--app=superset.tasks.celery_app:app",
        "worker",
        "--pool=prefork",
        "--concurrency=4",
        "--max-tasks-per-child=128",
        "-Ofair",
        "--loglevel=INFO",
      ],
      healthCheck: {
        command: [
          "CMD-SHELL",
          "celery -A superset.tasks.celery_app:app inspect ping -d celery@$HOSTNAME || exit 1",
        ],
        interval: cdk.Duration.seconds(60),
        timeout: cdk.Duration.seconds(30),
        retries: 3,
        startPeriod: cdk.Duration.seconds(60),
      },
    });

    new ecs.FargateService(this, "WorkerService", {
      cluster,
      taskDefinition: workerTaskDef,
      desiredCount: 1,
      securityGroups: [ecsSg],
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      circuitBreaker: { enable: true, rollback: true },
    });

    // ---------------------------------------------------------------
    // Celery beat scheduler (single instance)
    // ---------------------------------------------------------------
    const beatTaskDef = new ecs.FargateTaskDefinition(this, "BeatTaskDef", {
      memoryLimitMiB: 512,
      cpu: 256,
      executionRole,
      taskRole,
    });

    beatTaskDef.addContainer("superset-beat", {
      image: ecs.ContainerImage.fromDockerImageAsset(image),
      logging: ecs.LogDrivers.awsLogs({ logGroup, streamPrefix: "beat" }),
      environment: sharedEnv,
      secrets: { ...sharedSecrets, ...dbSecrets },
      command: [
        "celery",
        "--app=superset.tasks.celery_app:app",
        "beat",
        "--loglevel=INFO",
      ],
    });

    new ecs.FargateService(this, "BeatService", {
      cluster,
      taskDefinition: beatTaskDef,
      desiredCount: 1, // Must be exactly 1
      securityGroups: [ecsSg],
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
    });

    // ---------------------------------------------------------------
    // DB init task (run once on deployment)
    // ---------------------------------------------------------------
    const initTaskDef = new ecs.FargateTaskDefinition(this, "InitTaskDef", {
      memoryLimitMiB: 2048,
      cpu: 1024,
      executionRole,
      taskRole,
    });

    initTaskDef.addContainer("superset-init", {
      image: ecs.ContainerImage.fromDockerImageAsset(image),
      logging: ecs.LogDrivers.awsLogs({ logGroup, streamPrefix: "init" }),
      environment: {
        ...sharedEnv,
        ADMIN_PASSWORD: "CHANGE_ME_AFTER_FIRST_LOGIN",
      },
      secrets: { ...sharedSecrets, ...dbSecrets },
      command: [
        "bash",
        "-c",
        "superset db upgrade && superset fab create-admin --username admin --email admin@superset.com --password $ADMIN_PASSWORD --firstname Admin --lastname Superset || true && superset init",
      ],
      essential: true,
    });

    // ---------------------------------------------------------------
    // Outputs
    // ---------------------------------------------------------------
    new cdk.CfnOutput(this, "AlbDnsName", {
      value: alb.loadBalancerDnsName,
      description:
        "ALB DNS name - point your CloudFront origin to this",
    });

    new cdk.CfnOutput(this, "ClusterName", {
      value: cluster.clusterName,
    });

    new cdk.CfnOutput(this, "InitTaskDefArn", {
      value: initTaskDef.taskDefinitionArn,
      description:
        "Run this task once to initialize the database: aws ecs run-task --cluster <cluster> --task-definition <arn> --launch-type FARGATE --network-configuration ...",
    });
  }
}
