#!/usr/bin/env node
'use strict';
// Использование: node detect-stack.js [папка проекта]
// Печатает JSON: какие модули проверки включить и почему, список пунктов чек-листа, иностранная инфраструктура.
const path = require('path');
const { detectStack } = require('./lib/project');

const root = path.resolve(process.argv[2] || process.cwd());
process.stdout.write(JSON.stringify(detectStack(root), null, 2) + '\n');
