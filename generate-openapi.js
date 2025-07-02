require('dotenv').config()

const fs = require('fs');
const path = require('path');
const TJS = require('typescript-json-schema');
const jsonSchemaToOpenApiSchema = require('json-schema-to-openapi-schema');

// 1. Settings for typescript-json-schema
const settings = {
  required: true,
  noExtraProps: true,
};

const compilerOptions = {
  strictNullChecks: true,
};

const typeName = 'Person'; // change this if your root type has a different name
const outputDir = path.resolve(__dirname, process.env.OPENAPI_OUTPUT_DIR || 'openapi');
const outputFilename = process.env.OPENAPI_FILE_NAME || 'PersonService.json'
const outputFile = path.join(outputDir, outputFilename);

// 2. Generate JSON Schema from interfaces
const interfaceDir = path.resolve(__dirname, 'interfaces');
const tsFiles = fs.readdirSync(interfaceDir)
  .filter(f => f.endsWith('.ts'))
  .map(f => path.join(interfaceDir, f));
const program = TJS.getProgramFromFiles(tsFiles, compilerOptions);

const schema = TJS.generateSchema(program, typeName, settings);

if (!schema) {
  console.error(`Could not generate schema for type ${typeName}`);
  process.exit(1);
}

// 3. Convert JSON Schema to OpenAPI schema (optional but recommended)
const openApiSchema = jsonSchemaToOpenApiSchema(schema);

// 4. Create minimal OpenAPI spec
const openApiSpec = {
  openapi: '3.0.3',
  info: {
    title: 'Person Service API',
    version: '1.0.0',
  },
  paths: {
    '/person': {
      post: {
        summary: 'Create a person',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                $ref: '#/components/schemas/Person',
              },
            },
          },
        },
        responses: {
          '201': {
            description: 'Person created',
          },
        },
        'x-amazon-apigateway-integration': {
          uri: 'arn:aws:apigateway:{__REGION__}:lambda:path/2015-03-31/functions/{__LAMBDA_ARN__}/invocations',
          httpMethod: 'POST',
          type: 'aws_proxy'
        },
      },
    },
  },
  components: {
    schemas: {
      Person: openApiSchema,
    },
  },
};

// 5. Write to file
fs.writeFileSync(outputFile, JSON.stringify(openApiSpec, null, 2));
console.log(`OpenAPI spec generated at ${outputFile}`);