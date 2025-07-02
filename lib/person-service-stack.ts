import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';

import { ServicePrincipal } from 'aws-cdk-lib/aws-iam';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { RemovalPolicy, Stack, StackProps } from 'aws-cdk-lib';
import { Construct } from 'constructs';

import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as events from 'aws-cdk-lib/aws-events';

export class PersonServiceStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // dynamo stuff
    const tableName = process.env.TABLE_NAME || 'PersonTable';
    const removalPolicy = process.env.STAGE_NAME === 'prod' ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY;
    const personTable = new dynamodb.Table(this, tableName, {
      partitionKey: { name: 'id', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy
    });

    // lambda & auto scaling
    const createPersonFn = new NodejsFunction(this, 'CreatePersonFunction', {
      entry: path.join(__dirname, '../dist/lambda/create-person.js'),
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'handler',
      environment: {
        TABLE_NAME: personTable.tableName!,
      },
      bundling: {
        externalModules: ['aws-sdk'],
      },
    });

    const version = createPersonFn.currentVersion;

    const alias = new lambda.Alias(this, 'CreatePersonAlias', {
      aliasName: 'live',
      version,
    });

    alias.addAutoScaling({
      minCapacity: process.env.MIN_CONCURRENCY ? Number(process.env.MIN_CONCURRENCY) : 1,
      maxCapacity: process.env.MAX_CONCURRENCY ? Number(process.env.MAX_CONCURRENCY) : 5,
    }).scaleOnUtilization({
      utilizationTarget: process.env.UTILIZATION_PERCENTAGE ? Number(process.env.UTILIZATION_PERCENTAGE) : 0.7,
    });

    // eventbridge
    const bus = new events.EventBus(this, 'PersonEventsBus', {
      eventBusName: process.env.EVENT_BUS_NAME ?? 'PersonEvents',
    });
    
    // premissions
    personTable.grantWriteData(createPersonFn); // lambda can write
    bus.grantPutEventsTo(createPersonFn); // lambda can publish

    // openapi substitutions
    const openApiPath = path.join(
      __dirname,
      `../${process.env.OPENAPI_OUTPUT_DIR}/${process.env.OPENAPI_FILE_NAME}`
    );
    const rawOpenApi = fs.readFileSync(openApiPath, 'utf8');
    const openApiJson = JSON.parse(rawOpenApi);

    const integration = openApiJson.paths['/person'].post['x-amazon-apigateway-integration'];
    integration.uri = `arn:aws:apigateway:${Stack.of(this).region}:lambda:path/2015-03-31/functions/${createPersonFn.functionArn}/invocations`;


    // API Gateway
    const api = new apigateway.SpecRestApi(this, 'PersonApi', {
      apiDefinition: apigateway.ApiDefinition.fromInline(openApiJson),
      endpointConfiguration: {
        types: [apigateway.EndpointType.REGIONAL],
      },
      deployOptions: {
        stageName: process.env.STAGE_NAME,
      },
    });

    // allow API Gateway to invoke Lambda
    createPersonFn.addPermission('AllowAPIGatewayInvoke', {
      principal: new ServicePrincipal('apigateway.amazonaws.com'),
      action: 'lambda:InvokeFunction',
      sourceArn: `arn:aws:execute-api:${this.region}:${this.account}:*/*/*/*`,
    });
  }
}
