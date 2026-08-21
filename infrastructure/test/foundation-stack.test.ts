import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { beforeAll, describe, expect, it } from 'vitest';

import { FoundationStack } from '../lib/foundation-stack.js';
import cdkJson from '../cdk.json' with { type: 'json' };

type DeploymentStage = 'dev' | 'staging' | 'prod';

interface CdkContextConfig {
  frontendOriginDev: string;
  frontendOriginStaging: string;
  frontendOriginProd: string;
  apiThrottleRateLimitDev?: number;
  apiThrottleBurstLimitDev?: number;
  apiThrottleRateLimitStaging?: number;
  apiThrottleBurstLimitStaging?: number;
  apiThrottleRateLimitProd?: number;
  apiThrottleBurstLimitProd?: number;
}

const context = cdkJson.context as CdkContextConfig;

const stageOrigin = (stage: DeploymentStage): string => {
  if (stage === 'dev') {
    return context.frontendOriginDev;
  }

  if (stage === 'staging') {
    return context.frontendOriginStaging;
  }

  return context.frontendOriginProd;
};

const stageRateLimit = (stage: DeploymentStage): number => {
  if (stage === 'dev') {
    return context.apiThrottleRateLimitDev ?? 25;
  }

  if (stage === 'staging') {
    return context.apiThrottleRateLimitStaging ?? 75;
  }

  return context.apiThrottleRateLimitProd ?? 150;
};

const stageBurstLimit = (stage: DeploymentStage): number => {
  if (stage === 'dev') {
    return context.apiThrottleBurstLimitDev ?? 50;
  }

  if (stage === 'staging') {
    return context.apiThrottleBurstLimitStaging ?? 150;
  }

  return context.apiThrottleBurstLimitProd ?? 300;
};

const synthTemplate = (stage: DeploymentStage): Template => {
  const app = new App();
  const stack = new FoundationStack(app, `foundation-${stage}`, {
    stageName: stage,
    frontendAllowedOrigin: stageOrigin(stage),
    apiThrottleRateLimit: stageRateLimit(stage),
    apiThrottleBurstLimit: stageBurstLimit(stage),
  });

  return Template.fromStack(stack);
};

describe('foundation stack aws configuration', () => {
  let devTemplate: Template;
  let stagingTemplate: Template;
  let prodTemplate: Template;

  beforeAll(() => {
    devTemplate = synthTemplate('dev');
    stagingTemplate = synthTemplate('staging');
    prodTemplate = synthTemplate('prod');
  }, 120000);

  it('provisions required core resources', () => {
    const template = devTemplate;

    template.resourceCountIs('AWS::S3::Bucket', 1);
    template.resourceCountIs('AWS::CloudFront::Distribution', 1);
    template.resourceCountIs('AWS::ApiGatewayV2::Api', 1);
    expect(Object.keys(template.findResources('AWS::Lambda::Function')).length).toBeGreaterThanOrEqual(2);
    template.resourceCountIs('AWS::DynamoDB::Table', 1);
  }, 30000);

  it('routes /api through CloudFront to API Gateway and keeps API CORS explicit', () => {
    const template = stagingTemplate;

    template.hasResourceProperties('AWS::CloudFront::Distribution', {
      DistributionConfig: Match.objectLike({
        CacheBehaviors: Match.arrayWith([
          Match.objectLike({
            PathPattern: '/api/*',
            AllowedMethods: Match.arrayWith(['GET', 'HEAD', 'OPTIONS', 'PUT', 'PATCH', 'POST', 'DELETE']),
          }),
        ]),
        Origins: Match.arrayWith([
          Match.objectLike({
            CustomOriginConfig: Match.anyValue(),
          }),
        ]),
      }),
    });

    template.hasResourceProperties('AWS::ApiGatewayV2::Api', {
      CorsConfiguration: Match.objectLike({
        AllowOrigins: [context.frontendOriginStaging],
        AllowHeaders: Match.arrayWith(['content-type', 'idempotency-key']),
      }),
    });

    template.hasResourceProperties('AWS::ApiGatewayV2::Route', {
      RouteKey: 'POST /api/{proxy+}',
      AuthorizationType: 'NONE',
    });

    template.hasResourceProperties('AWS::ApiGatewayV2::Route', {
      RouteKey: 'DELETE /api/{proxy+}',
      AuthorizationType: 'NONE',
    });
  }, 30000);

  it('does not cache the frontend index between deployments', () => {
    const template = stagingTemplate;

    template.hasResourceProperties('AWS::CloudFront::CachePolicy', {
      CachePolicyConfig: {
        DefaultTTL: 0,
        MinTTL: 0,
        MaxTTL: 0,
      },
    });
  }, 30000);

  it('enables API Gateway stage throttling and access logging', () => {
    const template = prodTemplate;

    template.hasResourceProperties('AWS::ApiGatewayV2::Stage', {
      StageName: '$default',
      AutoDeploy: true,
      DefaultRouteSettings: {
        DetailedMetricsEnabled: true,
        ThrottlingRateLimit: stageRateLimit('prod'),
        ThrottlingBurstLimit: stageBurstLimit('prod'),
      },
      AccessLogSettings: Match.objectLike({
        DestinationArn: Match.anyValue(),
        Format: Match.anyValue(),
      }),
    });
  }, 30000);

  it('applies required project tags on taggable infrastructure resources', () => {
    const template = devTemplate;

    template.hasResourceProperties('AWS::S3::Bucket', {
      Tags: Match.arrayWith([
        { Key: 'project', Value: 'lucky-draw' },
      ]),
    });

    template.hasResourceProperties('AWS::S3::Bucket', {
      Tags: Match.arrayWith([
        { Key: 'organization', Value: 'dutta-brothers' },
      ]),
    });

    template.hasResourceProperties('AWS::DynamoDB::Table', {
      Tags: Match.arrayWith([
        { Key: 'project', Value: 'lucky-draw' },
      ]),
    });

    template.hasResourceProperties('AWS::DynamoDB::Table', {
      Tags: Match.arrayWith([
        { Key: 'organization', Value: 'dutta-brothers' },
      ]),
    });

    template.hasResourceProperties('AWS::Lambda::Function', {
      Tags: Match.arrayWith([
        { Key: 'project', Value: 'lucky-draw' },
      ]),
    });

    template.hasResourceProperties('AWS::Lambda::Function', {
      Tags: Match.arrayWith([
        { Key: 'organization', Value: 'dutta-brothers' },
      ]),
    });

    template.hasResourceProperties('AWS::ApiGatewayV2::Api', {
      Tags: Match.objectLike({
        project: 'lucky-draw',
        organization: 'dutta-brothers',
      }),
    });
  }, 30000);

  it('does not grant wildcard CloudFront invalidation permissions to deployment helper roles', () => {
    const template = devTemplate;

    const policies = template.findResources('AWS::IAM::Policy');
    const cloudFrontInvalidationStatements = Object.values(policies)
      .flatMap((policy) => {
        const statements = (policy as { Properties: { PolicyDocument: { Statement: unknown[] } } }).Properties
          .PolicyDocument.Statement;
        return statements;
      })
      .filter((statement) => {
        const candidate = statement as { Action?: string | string[] };
        const actions = Array.isArray(candidate.Action)
          ? candidate.Action
          : candidate.Action
            ? [candidate.Action]
            : [];

        return (
          actions.includes('cloudfront:CreateInvalidation') ||
          actions.includes('cloudfront:GetInvalidation')
        );
      });

    expect(cloudFrontInvalidationStatements).toHaveLength(0);
  }, 30000);
});
