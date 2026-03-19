#!/usr/bin/env node
import "source-map-support/register";
import * as cdk from "aws-cdk-lib";
import { SupersetInfraStack } from "../lib/infra-stack";
import { SupersetEcsStack } from "../lib/ecs-stack";

const app = new cdk.App();

const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION ?? "us-east-1",
};

// Stack 1: Shared infrastructure (VPC, RDS, ElastiCache)
const infra = new SupersetInfraStack(app, "SupersetInfra", {
  env,
  description: "Superset shared infrastructure: VPC, RDS, ElastiCache",
});

// Stack 2: ECS services (web, worker, beat, init)
new SupersetEcsStack(app, "SupersetEcs", {
  env,
  description: "Superset ECS Fargate services",
  vpc: infra.vpc,
  dbSecret: infra.dbSecret,
  rdsEndpoint: infra.rdsEndpoint,
  rdsPort: infra.rdsPort,
  redisEndpoint: infra.redisEndpoint,
  redisPort: infra.redisPort,
  dbSecurityGroup: infra.dbSecurityGroup,
  redisSecurityGroup: infra.redisSecurityGroup,
});
