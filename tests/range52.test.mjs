import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../dist/app.js', import.meta.url), 'utf8');
const dummy = {addEventListener(){}, classList:{toggle(){}}, setAttribute(){}};
const context = vm.createContext({
  document:{addEventListener(){},getElementById(){return dummy}},
  fetch:()=>new Promise(()=>{}),
  Intl, Date, Map, Number, String, Math, Promise, setInterval(){}
});
vm.runInContext(source, context);
const evaluate = expression => vm.runInContext(expression, context);

assert.equal(evaluate("columns.findIndex(c=>c[0]==='week52Position')"), evaluate("columns.findIndex(c=>c[0]==='dividendYield')")+1);
assert.equal(evaluate('range52Position({week52Low:20,week52High:40,price:30})'), 0.5);
assert.equal(evaluate('range52Position({week52Low:20,week52High:40,price:45})'), 1);
assert.equal(evaluate('range52Position({week52Low:20,week52High:40,price:15})'), 0);
assert.equal(evaluate('range52Position({week52Low:20,week52High:20,price:20})'), 0.5);
assert.equal(evaluate('range52Position({week52Low:20,week52High:40,price:null})'), null);
assert.equal(evaluate('range52Position({week52Low:40,week52High:20,price:30})'), null);
assert.match(evaluate('range52({week52Low:20,week52High:40,price:35})'), /left:25\.00%/);
assert.match(evaluate('range52({week52Low:20,week52High:40,price:35})'), /<span>40\.00<\/span><span>20\.00<\/span>/);
assert.match(evaluate('range52({week52Low:20,week52High:40,price:null})'), /السعر الحالي غير متاح/);
assert.doesNotMatch(evaluate('range52({week52Low:20,week52High:40,price:null})'), /range52-marker/);
assert.match(evaluate('range52({week52Low:null,week52High:null,price:30})'), /غير متاح/);
assert.doesNotMatch(evaluate('range52({week52Low:20,week52High:20,price:20})'), /NaN|Infinity/);
console.log('52-week range rendering and sorting tests passed');
