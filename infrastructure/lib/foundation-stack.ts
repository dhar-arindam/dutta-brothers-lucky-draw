import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  CfnOutput,
  Duration,
  Fn,
  RemovalPolicy,
  Stack,
  StackProps,
  Tags,
  aws_apigatewayv2 as apigwv2,
  aws_apigatewayv2_authorizers as apigwv2Authorizers,
  aws_apigateway as apigw,
  aws_cognito as cognito,
  aws_cloudfront as cloudfront,
  aws_cloudfront_origins as origins,
  aws_dynamodb as dynamodb,
  aws_lambda as lambda,
  aws_logs as logs,
  aws_s3 as s3,
  aws_s3_deployment as s3deploy,
} from 'aws-cdk-lib';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Construct } from 'constructs';

const currentDir = path.dirname(fileURLToPath(import.meta.url));

export interface FoundationStackProps extends StackProps {
  stageName?: 'dev' | 'staging' | 'prod';
  frontendAllowedOrigin: string;
  apiThrottleRateLimit: number;
  apiThrottleBurstLimit: number;
  cognitoDomainPrefix?: string;
}

export class FoundationStack extends Stack {
  public constructor(scope: Construct, id: string, props?: FoundationStackProps) {
    super(scope, id, props);

    Tags.of(this).add('project', 'lucky-draw');
    Tags.of(this).add('organization', 'dutta-brothers');

    if (!props) {
      throw new Error('FoundationStackProps are required.');
    }

    const stageName = props.stageName;
    const isProduction = stageName === 'prod';
    const frontendAllowedOrigin = props.frontendAllowedOrigin;
    const cognitoDomainPrefix = props.cognitoDomainPrefix ?? `dutta-draw-admin-${stageName}`;

    const frontendBucket = new s3.Bucket(this, 'FrontendBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      versioned: false,
      autoDeleteObjects: !isProduction,
      removalPolicy: isProduction ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY,
    });

    const drawsTable = new dynamodb.Table(this, 'DrawsTable', {
      partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecoverySpecification: {
        pointInTimeRecoveryEnabled: isProduction,
      },
      removalPolicy: isProduction ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY,
    });

    drawsTable.addGlobalSecondaryIndex({
      indexName: 'gsi1',
      partitionKey: { name: 'gsi1pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'gsi1sk', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    const apiLogGroup = new logs.LogGroup(this, 'ApiFunctionLogGroup', {
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: isProduction ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY,
    });

    const apiFunction = new NodejsFunction(this, 'ApiFunction', {
      entry: path.join(currentDir, '../../backend/src/lambda.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_22_X,
      memorySize: 512,
      timeout: Duration.seconds(10),
      bundling: {
        target: 'node22',
        sourceMap: false,
      },
      logGroup: apiLogGroup,
      environment: {
        APP_RUNTIME: 'PRODUCTION',
        DRAWS_TABLE_NAME: drawsTable.tableName,
      },
    });

    drawsTable.grantReadWriteData(apiFunction);

    const adminUserPool = new cognito.UserPool(this, 'AdminUserPool', {
      selfSignUpEnabled: false,
      signInAliases: { username: true },
      autoVerify: { email: true },
      mfa: cognito.Mfa.OFF,
      passwordPolicy: {
        minLength: 6,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: true,
      },
      removalPolicy: isProduction ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY,
    });
    const adminDomain = adminUserPool.addDomain('AdminDomain', {
      cognitoDomain: { domainPrefix: cognitoDomainPrefix },
    });
    const adminDomainCfn = adminDomain.node.defaultChild as cognito.CfnUserPoolDomain;
    adminDomainCfn.managedLoginVersion = 2;
    const adminScope = new cognito.ResourceServerScope({
      scopeName: 'admin',
      scopeDescription: 'Access Admin operations.',
    });
    const adminResourceServer = adminUserPool.addResourceServer('AdminResourceServer', {
      identifier: 'dutta-admin',
      scopes: [adminScope],
    });
    const adminClient = adminUserPool.addClient('AdminWebClient', {
      generateSecret: false,
      preventUserExistenceErrors: true,
      oAuth: {
        flows: { authorizationCodeGrant: true },
        scopes: [
          cognito.OAuthScope.OPENID,
          cognito.OAuthScope.EMAIL,
          cognito.OAuthScope.PROFILE,
          cognito.OAuthScope.resourceServer(adminResourceServer, adminScope),
        ],
        callbackUrls: [`${frontendAllowedOrigin}/admin`],
        logoutUrls: [`${frontendAllowedOrigin}/admin`],
      },
    });
    new cognito.CfnManagedLoginBranding(this, 'AdminManagedLoginBranding', {
      clientId: adminClient.userPoolClientId,
      userPoolId: adminUserPool.userPoolId,
      useCognitoProvidedValues: true,
    });

    const httpApi = new apigwv2.HttpApi(this, 'DrawApi', {
      createDefaultStage: false,
      corsPreflight: {
        allowHeaders: ['content-type', 'idempotency-key', 'authorization'],
        allowMethods: [
          apigwv2.CorsHttpMethod.GET,
          apigwv2.CorsHttpMethod.POST,
          apigwv2.CorsHttpMethod.PATCH,
          apigwv2.CorsHttpMethod.OPTIONS,
        ],
        allowOrigins: [frontendAllowedOrigin],
        maxAge: Duration.hours(1),
      },
    });

    const apiGatewayAccessLogs = new logs.LogGroup(this, 'ApiGatewayAccessLogs', {
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: isProduction ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY,
    });

    new apigwv2.HttpStage(this, 'DrawApiDefaultStage', {
      httpApi,
      stageName: '$default',
      autoDeploy: true,
      accessLogSettings: {
        destination: new apigwv2.LogGroupLogDestination(apiGatewayAccessLogs),
        format: apigw.AccessLogFormat.custom(
          JSON.stringify({
            requestId: '$context.requestId',
            requestTime: '$context.requestTime',
            httpMethod: '$context.httpMethod',
            routeKey: '$context.routeKey',
            status: '$context.status',
            protocol: '$context.protocol',
            responseLength: '$context.responseLength',
            integrationErrorMessage: '$context.integrationErrorMessage',
          }),
        ),
      },
      throttle: {
        rateLimit: props.apiThrottleRateLimit,
        burstLimit: props.apiThrottleBurstLimit,
      },
      detailedMetricsEnabled: true,
    });

    const integration = new HttpLambdaIntegration('ApiIntegration', apiFunction);
    const adminAuthorizer = new apigwv2Authorizers.HttpJwtAuthorizer(
      'AdminJwtAuthorizer',
      adminUserPool.userPoolProviderUrl,
      { jwtAudience: [adminClient.userPoolClientId] },
    );

    httpApi.addRoutes({
      path: '/api/admin/{proxy+}',
      methods: [apigwv2.HttpMethod.POST, apigwv2.HttpMethod.PATCH, apigwv2.HttpMethod.DELETE],
      integration,
      authorizer: adminAuthorizer,
      authorizationScopes: ['dutta-admin/admin'],
    });

    httpApi.addRoutes({
      path: '/api/admin/claims.csv',
      methods: [apigwv2.HttpMethod.GET],
      integration,
      authorizer: adminAuthorizer,
      authorizationScopes: ['dutta-admin/admin'],
    });

    httpApi.addRoutes({
      path: '/api/{proxy+}',
      methods: [
        apigwv2.HttpMethod.GET,
        apigwv2.HttpMethod.POST,
        apigwv2.HttpMethod.PATCH,
        apigwv2.HttpMethod.DELETE,
      ],
      integration,
    });

    const spaRewriteFunction = new cloudfront.Function(this, 'SpaRewriteFunction', {
      code: cloudfront.FunctionCode.fromInline(`function handler(event) {
  var request = event.request;
  var uri = request.uri;

  if (uri.startsWith('/api/')) {
    return request;
  }

  if (uri === '/' || uri.indexOf('.') === -1) {
    request.uri = '/index.html';
  }

  return request;
}`),
    });

    const apiDomainName = Fn.select(2, Fn.split('/', httpApi.apiEndpoint));
    const frontendCachePolicy = new cloudfront.CachePolicy(this, 'FrontendCachePolicy', {
      defaultTtl: Duration.seconds(0),
      minTtl: Duration.seconds(0),
      maxTtl: Duration.seconds(0),
    });
    const distribution = new cloudfront.Distribution(this, 'FrontendDistribution', {
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(frontendBucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: frontendCachePolicy,
        functionAssociations: [
          {
            eventType: cloudfront.FunctionEventType.VIEWER_REQUEST,
            function: spaRewriteFunction,
          },
        ],
      },
      additionalBehaviors: {
        '/api/*': {
          origin: new origins.HttpOrigin(apiDomainName, {
            protocolPolicy: cloudfront.OriginProtocolPolicy.HTTPS_ONLY,
          }),
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
          originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
        },
      },
      defaultRootObject: 'index.html',
    });

    const frontendDistPath = path.join(currentDir, '../../frontend/dist');
    new s3deploy.BucketDeployment(this, 'FrontendDeployment', {
      destinationBucket: frontendBucket,
      sources: [s3deploy.Source.asset(frontendDistPath)],
      prune: false,
      retainOnDelete: false,
    });

    new CfnOutput(this, 'FrontendBucketName', {
      value: frontendBucket.bucketName,
    });

    new CfnOutput(this, 'CloudFrontDistributionDomainName', {
      value: distribution.domainName,
    });

    new CfnOutput(this, 'ApiBaseUrl', {
      value: httpApi.apiEndpoint,
    });

    new CfnOutput(this, 'AdminUserPoolId', {
      value: adminUserPool.userPoolId,
    });

    new CfnOutput(this, 'AdminUserPoolClientId', {
      value: adminClient.userPoolClientId,
    });

    new CfnOutput(this, 'AdminCognitoDomain', {
      value: adminDomain.domainName,
    });

    new CfnOutput(this, 'DrawsTableName', {
      value: drawsTable.tableName,
    });
  }
}
