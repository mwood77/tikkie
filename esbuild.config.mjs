import { build } from 'esbuild';
import UnpluginTypia from '@ryoppippi/unplugin-typia/esbuild';
import { copyFileSync, mkdirSync, existsSync } from 'fs';
import { execSync } from 'child_process';

if (!existsSync('dist')) {
  mkdirSync('dist', { recursive: true });
}
if (!existsSync('dist/lambda')) {
  mkdirSync('dist/lambda', { recursive: true });
}

build({
  entryPoints: ['./lambda/create-person.ts'],
  bundle: true,
  platform: 'node',
  target: 'node18',
  outfile: 'dist/lambda/create-person.js',
  sourcemap: true,
  external: ['aws-sdk'],
  plugins: [
    UnpluginTypia({}),
  ],
}).catch(() => process.exit(1));

copyFileSync('package.json', 'dist/lambda/package.json');

execSync('cd dist/lambda && npm install --production', { stdio: 'inherit' });
