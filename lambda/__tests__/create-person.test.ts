import { handler } from '../create-person';
import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBClient, PutItemCommand } from '@aws-sdk/client-dynamodb';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';

import { createApiGatewayEvent } from './utils/create-api-gateway-proxy-event';

const ddbMock = mockClient(DynamoDBClient);
const ebMock = mockClient(EventBridgeClient);

// we're setting the UUID V4 function to return a 
// fixed value for deterministic testing...
jest.mock('uuid', () => ({
  v4: () => 'mocked-uuid',
}));

beforeEach(() => {
  ddbMock.reset();
  ebMock.reset();
});

describe('create-person Lambda', () => {
  it('creates person and publishes event', async () => {
    ddbMock.on(PutItemCommand).resolves({});
    ebMock.on(PutEventsCommand).resolves({ Entries: [{ EventId: 'event-123' }] });

    const response = await handler(
      createApiGatewayEvent({
        body: JSON.stringify({
          firstName: 'Alice',
          lastName: 'Smith',
          phoneNumber: '555-1234',
          address: {
            street: 'AWS Way',
            houseNumber: '1',
            city: 'Seattle',
            state: 'WA',
            country: 'USA',
            postalCode: '98101',
          },
        }),
      })
    );

    expect(ddbMock.calls()[0].args[0].input).toEqual({
      TableName: process.env.TABLE_NAME,
      Item: {
        id: { S: 'mocked-uuid' },
        firstName: { S: 'Alice' },
        lastName: { S: 'Smith' },
        phoneNumber: { S: '555-1234' },
        address: {
          M: {
            street: { S: 'AWS Way' },
            houseNumber: { S: '1' },
            city: { S: 'Seattle' },
            state: { S: 'WA' },
            country: { S: 'USA' },
            postalCode: { S: '98101' },
          },
        },
      },
    });

    expect(ebMock.calls()[0].args[0].input).toMatchObject({
      Entries: [
        {
          Source: 'person.service',
          DetailType: 'PersonCreated',
          EventBusName: 'PersonEvents',
        },
      ],
    });

    expect(response.statusCode).toBe(201);
    expect(JSON.parse(response.body)).toEqual({ id: 'mocked-uuid' });
  });

  it('returns 400 on when the request body (parent) is missing required fields', async () => {
    const response = await handler(
      createApiGatewayEvent({
        body: JSON.stringify({
          // phoneNumber & lastName are missing
          firstName: 'Alice',
          address: {
            street: 'AWS Way',
            houseNumber: '1',
            city: 'Seattle',
            state: 'WA',
            country: 'USA',
            postalCode: '98101',
          },
        }),
      })
    );

    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body)).toEqual(
      { 
        error: 'Invalid person data', 
        details: [
          {
            "expected": "string",
            "path": "$input.lastName",
          }, 
          {
            "expected": "string",
            "path": "$input.phoneNumber",
          },
        ],
      }
    );
  });

  it('returns 400 on when the request body (child: Address) is missing required fields', async () => {
    const response = await handler(
      createApiGatewayEvent({
        body: JSON.stringify({
          firstName: 'Alice',
          lastName: 'Smith',
          phoneNumber: '555-1234',
          address: {
            // street is missing
            houseNumber: '1',
            city: 'Seattle',
            state: 'WA',
            country: 'USA',
            postalCode: '98101',
          },
        }),
      })
    );

    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body)).toEqual(
      { 
        error: 'Invalid person data', 
        details: [
          {
            "expected": "string",
            "path": "$input.address.street",
          }, 
        ],
      }
    );
  });

  it('returns 400 on invalid JSON', async () => {
    const response = await handler(
      createApiGatewayEvent({
        body: 'not-json',
      })
    );

    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body)).toEqual({ error: 'Invalid JSON body' });
  });

  it('returns 500 when DynamoDB fails', async () => {
    ddbMock.on(PutItemCommand).rejects(new Error('DynamoDB connection failed'));
    ebMock.on(PutEventsCommand).resolves({ Entries: [{ EventId: 'event-123' }] });

    const response = await handler(
      createApiGatewayEvent({
        body: JSON.stringify({
          firstName: 'Alice',
          lastName: 'Smith',
          phoneNumber: '555-1234',
          address: {
            street: 'AWS Way',
            houseNumber: '1',
            city: 'Seattle',
            state: 'WA',
            country: 'USA',
            postalCode: '98101',
          },
        }),
      })
    );

    expect(response.statusCode).toBe(500);
    expect(JSON.parse(response.body)).toEqual({ 
      error: 'Failed to create person' 
    });
    
    // EventBridge should not be called if DynamoDB fails
    expect(ebMock.calls()).toHaveLength(0);
  });

  it('returns 500 when EventBridge fails (but person is still created)', async () => {
    ddbMock.on(PutItemCommand).resolves({});
    // Make EventBridge feel sad
    ebMock.on(PutEventsCommand).rejects(new Error('EventBridge unavailable'));

    const response = await handler(
      createApiGatewayEvent({
        body: JSON.stringify({
          firstName: 'Alice',
          lastName: 'Smith',
          phoneNumber: '555-1234',
          address: {
            street: 'AWS Way',
            houseNumber: '1',
            city: 'Seattle',
            state: 'WA',
            country: 'USA',
            postalCode: '98101',
          },
        }),
      })
    );

    expect(response.statusCode).toBe(500);
    expect(JSON.parse(response.body)).toEqual({ 
      error: 'Failed to publish event' 
    });
    
    // DynamoDB is still called because we're now deleting the person,
    // due to event bridge's failure
    expect(ddbMock.calls()).toHaveLength(2);
  });

});
