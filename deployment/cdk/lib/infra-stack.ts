import * as cdk from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as rds from "aws-cdk-lib/aws-rds";
import * as elasticache from "aws-cdk-lib/aws-elasticache";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import { Construct } from "constructs";

export class SupersetInfraStack extends cdk.Stack {
  public readonly vpc: ec2.IVpc;
  public readonly dbSecret: secretsmanager.ISecret;
  public readonly rdsEndpoint: string;
  public readonly rdsPort: string;
  public readonly redisEndpoint: string;
  public readonly redisPort: string;
  public readonly dbSecurityGroup: ec2.ISecurityGroup;
  public readonly redisSecurityGroup: ec2.ISecurityGroup;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // ---------------------------------------------------------------
    // VPC
    // ---------------------------------------------------------------
    this.vpc = new ec2.Vpc(this, "SupersetVpc", {
      maxAzs: 2,
      natGateways: 1,
      subnetConfiguration: [
        {
          cidrMask: 24,
          name: "Public",
          subnetType: ec2.SubnetType.PUBLIC,
        },
        {
          cidrMask: 24,
          name: "Private",
          subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
        },
        {
          cidrMask: 28,
          name: "Isolated",
          subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
        },
      ],
    });

    // ---------------------------------------------------------------
    // RDS PostgreSQL (metadata database)
    // ---------------------------------------------------------------
    this.dbSecurityGroup = new ec2.SecurityGroup(this, "DbSg", {
      vpc: this.vpc,
      description: "Superset RDS PostgreSQL",
      allowAllOutbound: false,
    });

    const dbCredentials = rds.Credentials.fromGeneratedSecret("superset", {
      secretName: "superset/rds-credentials",
    });

    const dbInstance = new rds.DatabaseInstance(this, "SupersetDb", {
      engine: rds.DatabaseInstanceEngine.postgres({
        version: rds.PostgresEngineVersion.VER_16_12,
      }),
      instanceType: ec2.InstanceType.of(
        ec2.InstanceClass.T4G,
        ec2.InstanceSize.MEDIUM
      ),
      vpc: this.vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      securityGroups: [this.dbSecurityGroup],
      credentials: dbCredentials,
      databaseName: "superset",
      allocatedStorage: 20,
      maxAllocatedStorage: 100,
      storageEncrypted: true,
      multiAz: false, // Set true for production HA
      deletionProtection: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      backupRetention: cdk.Duration.days(7),
    });

    this.dbSecret = dbInstance.secret!;
    this.rdsEndpoint = dbInstance.dbInstanceEndpointAddress;
    this.rdsPort = dbInstance.dbInstanceEndpointPort;

    // ---------------------------------------------------------------
    // ElastiCache Redis (cache + Celery broker)
    // ---------------------------------------------------------------
    this.redisSecurityGroup = new ec2.SecurityGroup(this, "RedisSg", {
      vpc: this.vpc,
      description: "Superset ElastiCache Redis",
      allowAllOutbound: false,
    });

    const redisSubnetGroup = new elasticache.CfnSubnetGroup(
      this,
      "RedisSubnetGroup",
      {
        description: "Superset Redis subnet group",
        subnetIds: this.vpc.selectSubnets({
          subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
        }).subnetIds,
        cacheSubnetGroupName: "superset-redis",
      }
    );

    const redisCluster = new elasticache.CfnCacheCluster(this, "RedisCluster", {
      engine: "redis",
      cacheNodeType: "cache.t4g.medium",
      numCacheNodes: 1,
      port: 6379,
      vpcSecurityGroupIds: [this.redisSecurityGroup.securityGroupId],
      cacheSubnetGroupName: redisSubnetGroup.cacheSubnetGroupName,
      engineVersion: "7.1",
      autoMinorVersionUpgrade: true,
    });
    redisCluster.addDependency(redisSubnetGroup);

    this.redisEndpoint = redisCluster.attrRedisEndpointAddress;
    this.redisPort = redisCluster.attrRedisEndpointPort;

    // ---------------------------------------------------------------
    // Superset SECRET_KEY in Secrets Manager
    // ---------------------------------------------------------------
    new secretsmanager.Secret(this, "SupersetSecretKey", {
      secretName: "superset/secret-key",
      description: "Superset SECRET_KEY for session signing",
      generateSecretString: {
        excludePunctuation: false,
        passwordLength: 64,
      },
    });

    // ---------------------------------------------------------------
    // Outputs
    // ---------------------------------------------------------------
    new cdk.CfnOutput(this, "VpcId", { value: this.vpc.vpcId });
    new cdk.CfnOutput(this, "RdsEndpoint", { value: this.rdsEndpoint });
    new cdk.CfnOutput(this, "RedisEndpoint", { value: this.redisEndpoint });
  }
}
