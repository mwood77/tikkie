import { App } from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { PersonServiceStack } from '../person-service-stack';

describe('PersonServiceStack', () => {
  let template: Template;

  beforeAll(() => {
    const app = new App();
    const stack = new PersonServiceStack(app, 'TestStack');
    template = Template.fromStack(stack);
  });

  test('DynamoDB Table Created with Correct Properties', () => {
    template.hasResourceProperties('AWS::DynamoDB::Table', {
      BillingMode: 'PAY_PER_REQUEST',
      KeySchema: [
        {
          AttributeName: 'id',
          KeyType: 'HASH',
        },
      ],
      AttributeDefinitions: [
        {
          AttributeName: 'id',
          AttributeType: 'S',
        },
      ],
    });

    // dynamo deletion policy
    template.hasResource('AWS::DynamoDB::Table', {
        DeletionPolicy: 'Delete',
    });
  });

  test('Lambda Function Created with Environment Variables and Correct Runtime', () => {
    template.hasResourceProperties('AWS::Lambda::Function', {
      Runtime: 'nodejs18.x',
      Handler: 'index.handler',
      Environment: {
        Variables: {
          TABLE_NAME: {
            Ref: Match.stringLikeRegexp('PersonTable'),
          },
        },
      },
    });
  });

  test('API Gateway SpecRestApi created with inline OpenAPI definition', () => {
    template.hasResourceProperties('AWS::ApiGateway::RestApi', {
      Body: Match.objectLike({
        paths: Match.objectLike({
          '/person': Match.anyValue(),
        }),
      }),
    });
  });

  test('EventBridge EventBus Created', () => {
    template.hasResourceProperties('AWS::Events::EventBus', {
      Name: 'PersonEvents',
    });
  });

  test('Lambda IAM Role has correct AssumeRole policy and managed policies', () => {
    template.hasResourceProperties('AWS::IAM::Role', {
      AssumeRolePolicyDocument: {
        Statement: [
          {
            Action: 'sts:AssumeRole',
            Effect: 'Allow',
            Principal: {
              Service: 'lambda.amazonaws.com',
            },
          },
        ],
        Version: '2012-10-17',
      },
      ManagedPolicyArns: Match.arrayWith([
        {
          'Fn::Join': [
            '',
            [
              'arn:',
              { Ref: 'AWS::Partition' },
              ':iam::aws:policy/service-role/AWSLambdaBasicExecutionRole',
            ],
          ],
        },
      ]),
    });
  });

  test('Lambda IAM Policy includes DynamoDB and EventBridge permissions', () => {
    template.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: Match.arrayWith([
              'dynamodb:BatchWriteItem',
              'dynamodb:PutItem',
              'dynamodb:UpdateItem',
              'dynamodb:DeleteItem',
              'dynamodb:DescribeTable',
            ]),
            Effect: 'Allow',
            Resource: Match.anyValue(),
          }),
          Match.objectLike({
            Action: 'events:PutEvents',
            Effect: 'Allow',
            Resource: Match.anyValue(),
          }),
        ]),
        Version: '2012-10-17',
      },
    });
  });

});
