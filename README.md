# ez-jscodeshift

ez-jscodeshift is a wrapper around [jscodeshift](https://github.com/facebook/jscodeshift) to simple finding and replacing AST Nodes.

## Install
```
$ npm install -g https://github.com/knilink/ez-jscodeshift.git
```

## Usage

ez-jscodeshift use [tagged template expression](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Template_literals) to descript the filter and define node binding names.

To apply ez-jscodeshift, just simple wrap it over jscodeshift
``` js
const jz = require('ez-jscodeshift')(require('jscodeshift'));
```

### Basic Example
``` js
jz(`it('should work', () => {
  assert.equal(foo(), 'bar');
});`)
  .ezFind`assert.equal(${'a'}, ${'b'})`
  .ezReplaceWith`expect(${'a'}).to.equal(${'b'})`
  .toSource()
```
Origin
``` js
it('should work', () => {
  assert.equal(foo(), 'bar');
});
```
Result
``` js
it('should work', () => {
  expect(foo()).to.equal('bar');
});
```

### Custom filter
``` js
jz(`expect(r1).to.equal('foo');
expect('bar').to.equal(r2);`)
  .ezFind`expect(${['a', { type: 'Literal' }]}).to.equal(${'b'})`
  .ezReplaceWith`expect(${'b'}).to.equal(${'a'})`
  .toSource()
```
Origin
``` js
expect(r1).to.equal('foo');
expect('bar').to.equal(r2);
```
Result
``` js
expect(r1).to.equal('foo');
expect(r2).to.equal('bar');
```

### Custom Binding
``` js
jz('myObj.myFun(...[b,c,d])')
  .ezFind`${'f'}(...${['a', { type: 'ArrayExpression', elements: (b) => ({ b }) }]})`
  .ezReplaceWith`${$ => j.callExpression($.f.value, $.b.value)}`
  .toSource();
```
Origin
``` js
myObj.myFun(...[b,c,d])
```
Result
``` js
myObj.myFun(b, c, d)
```

### Block statement
``` js
jz(`mylist.forEach(item=>{
  console.log(item);
})`)
  .ezFind`${'list'}.forEach((${'i'})=>${'{body}'})`
  .ezReplaceWith`for(const ${'i'} of ${'list'}) ${'{body}'}`
  .toSource();
```
Origin

``` js
mylist.forEach(item=>{
  console.log(item);
})
```

Result

``` js
for(const item of list) {
  console.log(item);
};
```

### Tagged template statement
``` js
jz("tag`foo${'bar'}baz`")
  .ezFind`tag${'`t`'}`
  .ezReplaceWith`tag2${'`t`'}`
  .toSource()
```
Origin
``` js
tag`foo${'bar'}baz`
```
Result
``` js
tag2`foo${'bar'}baz`;
```

### Other examples

``` js
jz(`expect(foo,'my error description').to.equal('foo');`)
  .ezFind`expect(${'a'},${'comment'}).to.equal(${'b'})`
  .ezReplaceWith`expect(${'a'}).toBe(${'b'})`
  .ezReplaceWith`${($, path) => {
      const ast = path.value;
      const commentAst = $.comment.value;
      ast.expression.comments = [j.commentLine(' ' + commentAst.value)];
      return ast;
    }}`
  .toSource()
```
Origin
``` js
expect(foo,'my error description').to.equal('foo');
```
Result
``` js
// my error description
expect(foo).toBe('foo');
```
