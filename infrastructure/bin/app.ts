import * as cdk from 'aws-cdk-lib';

import { FoundationStack } from '../lib/foundation-stack.js';

const app = new cdk.App();

type DeploymentStage = 'dev' | 'staging' | 'prod';

const stageValue = app.node.tryGetContext('stage') ?? 'dev';
if (stageValue !== 'dev' && stageValue !== 'staging' && stageValue !== 'prod') {
  throw new Error('Context "stage" must be one of: dev, staging, prod.');
}

const stageName: DeploymentStage = stageValue;

const stageSuffix = stageName.charAt(0).toUpperCase() + stageName.slice(1);
const frontendOrigin = app.node.tryGetContext(`frontendOrigin${stageSuffix}`);

if (typeof frontendOrigin !== 'string' || frontendOrigin.trim().length === 0) {
  throw new Error(`Context "frontendOrigin${stageSuffix}" is required for stage "${stageName}".`);
}

const frontendAllowedOrigin = frontendOrigin.trim();
const isLocalOrigin = /^(https?:\/\/)(localhost|127\.0\.0\.1)(:\d+)?$/i.test(frontendAllowedOrigin);

if (stageName === 'prod' && isLocalOrigin) {
  throw new Error('Production stage cannot use a localhost frontend origin.');
}

const defaultRateByStage: Record<DeploymentStage, number> = {
  dev: 25,
  staging: 75,
  prod: 150,
};

const defaultBurstByStage: Record<DeploymentStage, number> = {
  dev: 50,
  staging: 150,
  prod: 300,
};

const rateLimitContext = app.node.tryGetContext(`apiThrottleRateLimit${stageSuffix}`);
const burstLimitContext = app.node.tryGetContext(`apiThrottleBurstLimit${stageSuffix}`);

const apiThrottleRateLimit =
  typeof rateLimitContext === 'number' ? rateLimitContext : defaultRateByStage[stageName];
const apiThrottleBurstLimit =
  typeof burstLimitContext === 'number' ? burstLimitContext : defaultBurstByStage[stageName];

if (apiThrottleRateLimit <= 0 || apiThrottleBurstLimit <= 0) {
  throw new Error('API throttling limits must be positive numbers.');
}

const stackNameByStage: Record<DeploymentStage, string> = {
  dev: 'DuttaDrawFoundationStackDev',
  staging: 'DuttaDrawFoundationStackStaging',
  prod: 'DuttaDrawFoundationStackProd',
};

new FoundationStack(app, stackNameByStage[stageName], {
  stageName,
  frontendAllowedOrigin,
  apiThrottleRateLimit,
  apiThrottleBurstLimit,
});
