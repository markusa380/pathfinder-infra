#!/usr/bin/env node
import "source-map-support/register";
import * as cdk from "@aws-cdk/core";
import { PathfinderInfraStack } from "../lib/pathfinder-infra-stack";

const app = new cdk.App();
new PathfinderInfraStack(app, "PathfinderInfraStackV2", {
  env: { account: '794147591978', region: 'eu-west-1' },
  /* For more information, see https://docs.aws.amazon.com/cdk/latest/guide/environments.html */
});
