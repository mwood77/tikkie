const { resolve } = require('path');

module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/lib', '<rootDir>/lambda'],
  setupFiles: [resolve(__dirname, 'jest.env.js')],
  testMatch: ['**/*.test.ts'],
  transform: {
    '^.+\\.tsx?$': 'ts-jest',
  },
};
