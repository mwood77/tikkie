import 'dotenv/config';

import typia from 'typia';
import { DynamoDBClient, PutItemCommand, DeleteItemCommand } from "@aws-sdk/client-dynamodb";
import { EventBridgeClient, PutEventsCommand } from "@aws-sdk/client-eventbridge";
import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { v4 as uuidv4 } from 'uuid';

import { Person } from '../interfaces/person';

const db = new DynamoDBClient({
    ...(process.env.AWS_SAM_LOCAL && {
      endpoint: 'http://host.docker.internal:8000'
    })
});
const eb = new EventBridgeClient({});
const TABLE_NAME = process.env.TABLE_NAME;

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  let body: Person;
  
  try {
    body = JSON.parse(event.body!);
  } catch (err) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'Invalid JSON body' }),
    };
  }
  
  const validation = typia.validate<Person>(body);  // modern runtime validation library, instead of zod or whatever
  if (!validation.success) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'Invalid person data', details: validation.errors }),
    };
  }
  
  const id = uuidv4();

  try {
    await db.send(new PutItemCommand({
      TableName: TABLE_NAME,
      Item: {
        id: { S: id },
        firstName: { S: body.firstName },
        lastName: { S: body.lastName },
        phoneNumber: { S: body.phoneNumber },
        address: {
          M: {
            street: { S: body.address.street },
            houseNumber: { S: body.address.houseNumber },
            ...(body.address.apartmentNumber !== undefined
              ? { apartmentNumber: { S: body.address.apartmentNumber } }
              : {}),
            city: { S: body.address.city },
            state: { S: body.address.state },
            country: { S: body.address.country },
            postalCode: { S: body.address.postalCode },
          },
        },
      },
    }));
  } catch (error) {
    console.error('DynamoDB error:', error);
    return {
        statusCode: 500,
        body: JSON.stringify({ error: 'Failed to create person' }),
    };
  }

  try {
    await eb.send(new PutEventsCommand({
      Entries: [
        {
          Source: "person.service",
          DetailType: "PersonCreated",
          Detail: JSON.stringify({ id, ...body }),
          EventBusName: process.env.EVENT_BUS_NAME ?? "PersonEvents",
        },
      ],
    }));
  } catch (error) {
    console.error('EventBridge error:', error);
    
    try {
      console.error('Rolling back user creation in db for user id:', id);
      await db.send(new DeleteItemCommand({ 
        TableName: TABLE_NAME, 
        Key: { id: { S: id } },
        ConditionExpression: 'attribute_exists(id)'
      }));
    } catch (rollbackError) {
      console.error('CRITICAL: Failed to rollback user creation', { id, rollbackError });
      
      // this is a pretty bad state to be in, in a real system we'd 
      // want to retry this, or dispatch to a dead-letter queue.
      
      // I guess we could could also re-write this to be idempotent. 
      // We could store the event state in dynamo alongside the person 
      // record - we'd have something like a worker that retries with backoff; 
      // "eventual consistency."
    }
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Failed to publish event' }),
    };
  }
    
  return {
    statusCode: 201,
    body: JSON.stringify({ id }),
  };

};
