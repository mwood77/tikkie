// this file sets up the environment for Jest tests 
// we load environment variables from .env.test
const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.resolve(__dirname, '.env.test') });
