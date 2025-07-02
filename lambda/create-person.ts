import 'dotenv/config';

import typia from 'typia';
import { DynamoDBClient, PutItemCommand } from "@aws-sdk/client-dynamodb";
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
            zipCode: { S: body.address.postalCode },
          },
        },
      },
    }));
    
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
    
    return {
      statusCode: 201,
      body: JSON.stringify({ id }),
    };
  };
