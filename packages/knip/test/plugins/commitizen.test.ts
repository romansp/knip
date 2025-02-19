import assert from 'node:assert/strict';
import test from 'node:test';
import { default as commitizen } from '../../src/plugins/commitizen/index.js';
import { resolve, join } from '../../src/util/path.js';
import { buildOptions } from '../helpers/index.js';

const cwd = resolve('fixtures/plugins/commitizen');
const options = buildOptions(cwd);

test('Find dependencies in commitizen configuration (package.json)', async () => {
  const configFilePath = join(cwd, 'package.json');
  const dependencies = await commitizen.findDependencies(configFilePath, options);
  assert.deepEqual(dependencies, ['cz-conventional-changelog']);
});

test('Find dependencies in commitizen configuration (.czrc)', async () => {
  const configFilePath = join(cwd, '.czrc');
  const dependencies = await commitizen.findDependencies(configFilePath, options);
  assert.deepEqual(dependencies, ['cz-conventional-changelog']);
});
