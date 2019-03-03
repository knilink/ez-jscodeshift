function randVarName() {
  return 'v' + Math.round(Math.random() * Number.MAX_SAFE_INTEGER);
}

function get(ast, path) {
  let result = ast;
  for (const i of path) {
    if (!result) return undefined;
    result = result[i];
  }
  return result;
}

function set(ast, path, value) {
  let target = ast;
  const _path = path.slice(0, -1);
  const prop = path[path.length - 1];
  for (const i of _path) {
    if (!target) return false;
    target = target[i];
  }
  target[prop] = value;
  return true;
}

function bindCustomMatcher(types, matcher, path) {
  const isFunction = types.builtInTypes.function;
  const isObject = types.builtInTypes.object;

  if (isFunction.check(matcher)) {
    return [
      {
        srcPath: path,
        getter: matcher,
      },
    ];
  }

  if (isObject.check(matcher)) {
    const childNames = types.getFieldNames(matcher);
    return childNames.reduce(
      (result, childName) => [...result, ...bindCustomMatcher(types, matcher[childName], [...path, childName])],
      []
    );
  }
  return [];
}

function bindSource(types, ast, bindings = {}, path = []) {
  const isArray = types.builtInTypes.array;
  const isObject = types.builtInTypes.object;

  let bindingsRes = bindings;
  if (isArray.check(ast)) {
    let result = {};
    for (const i in ast) {
      var { matcher: newAst, bindings: newBindings } = bindSource(types, ast[i], bindingsRes, [...path, i]);
      bindingsRes = newBindings;
      if (newAst) {
        result[i] = newAst;
      }
    }
    result.length = ast.length;
    return { matcher: result, bindings: bindingsRes };
  }

  if (!isObject.check(ast)) {
    return {
      matcher: ast,
      bindings,
    };
  }

  if (types.namedTypes.Identifier.check(ast) && ast.name in bindings) {
    return {
      matcher: bindings[ast.name].matcher,
      bindings: {
        ...bindingsRes,
        [ast.name]: {
          srcPath: path,
          ...bindings[ast.name],
        },
      },
    };
  }

  const childNames = types.getFieldNames(ast);
  const result = {};
  for (const name of childNames) {
    const { matcher: newAst, bindings: newBindings } = bindSource(types, ast[name], bindingsRes, [...path, name]);
    bindingsRes = newBindings;
    if (newAst || (ast.type === 'Literal' && name === 'value')) {
      result[name] = newAst;
    }
  }
  return {
    matcher: result,
    bindings: bindingsRes,
  };
}

function bindDst(types, ast, bindings = {}, path = []) {
  const isArray = types.builtInTypes.array;
  const isObject = types.builtInTypes.object;

  let bindingsRes = bindings;
  if (isArray.check(ast)) {
    for (const i in ast) {
      bindingsRes = bindDst(types, ast[i], bindingsRes, [...path, i]).bindings;
    }
    return { bindings: bindingsRes };
  }

  if (!isObject.check(ast)) {
    return {
      bindings,
    };
  }

  if (types.namedTypes.Identifier.check(ast) && ast.name in bindings) {
    return {
      bindings: {
        ...bindingsRes,
        [ast.name]: {
          ...bindings[ast.name],
          dstPaths: [...(bindings[ast.name].dstPaths || []), path],
        },
      },
    };
  }

  const childNames = types.getFieldNames(ast);
  for (const name of childNames) {
    bindingsRes = bindDst(types, ast[name], bindingsRes, [...path, name]).bindings;
  }
  return {
    bindings: bindingsRes,
  };
}

var traversalMethods = {
  ezFind: function(code, ...args) {
    const { options } = this.__ezContext;
    const j = this.__ezContext.getJ();

    let bindings = {};
    let source = code[0];
    for (const i in args) {
      const [name, customMatcher] = j.types.builtInTypes.array.check(args[i]) ? args[i] : [args[i]];
      bindings[name] = { matcher: customMatcher };
      source += name + code[+i + 1];
    }
    let _ast = j(source, options).get().value.program.body[0];
    if (_ast.type === 'ExpressionStatement') {
      _ast = _ast.expression;
    }
    const { matcher, bindings: newBindings } = bindSource(j.types, _ast, bindings);
    for (const i in newBindings) {
      if (newBindings[i].matcher) {
        newBindings[i].getters = bindCustomMatcher(j.types, newBindings[i].matcher, []);
      }
    }

    let matchedCollection = this.find(j.types.namedTypes[matcher.type], matcher);
    matchedCollection.__ezContext = { ...this.__ezContext, bindings: { ...this.__ezContext.bindings, ...newBindings } };

    matchedCollection.ezReplaceWith = mutationMethods.ezReplaceWith;
    return matchedCollection;
  },
};

var mutationMethods = {
  ezReplaceWith: function(code, ...args) {
    const { options, bindings } = this.__ezContext;
    const j = this.__ezContext.getJ();
    const isFunction = j.types.builtInTypes.function;

    let targetBindings = {};
    let targetSourceCode = code[0];
    for (const i in args) {
      if (isFunction.check(args[i])) {
        const name = randVarName();
        targetBindings[name] = {
          setter: args[i],
        };
        targetSourceCode += name + code[+i + 1];
      } else {
        targetBindings[args[i]] = {};
        targetSourceCode += args[i] + code[+i + 1];
      }
    }
    return this.replaceWith((path) => {
      const targetAst = j(targetSourceCode, options).get().value.program.body[0];
      targetBindings = bindDst(j.types, targetAst, targetBindings).bindings;

      const value = path.value;

      let bindingResult = {};
      for (const i in bindings) {
        bindingResult[i] = {
          value: get(value, bindings[i].srcPath),
          ...bindings[i],
          srcPath: undefined,
        };
        if (bindings[i].getters) {
          for (const getter of bindings[i].getters) {
            const res = getter.getter(get(bindingResult[i].value, getter.srcPath));
            if (j.types.builtInTypes.object.check(res)) {
              for (const j in res) {
                bindingResult[j] = { value: res[j] };
              }
            }
          }
        }
      }

      for (const i in targetBindings) {
        for (const dstPath of targetBindings[i].dstPaths) {
          if (targetBindings[i].setter) {
            const newNode = targetBindings[i].setter(bindingResult);
            newNode && set(targetAst, dstPath, newNode);
          } else if (i in bindingResult) {
            set(targetAst, dstPath, bindingResult[i].value);
          }
        }
      }
      if (targetAst) {
        targetAst.comments = value.comments;
      }
      return targetAst;
    });
  },
};

var j = require('jscodeshift');

function wrap(j) {
  function core(source, options) {
    const ast = j(source, options);
    ast.__ezContext = {
      getJ() {
        return j;
      },
      options,
    };
    ast.ezFind = traversalMethods.ezFind;
    return ast;
  }
  const withParser = j.withParser;
  core.withParser = function(...args) {
    return wrap(withParser(...args));
  };

  return Object.assign(core, j);
}

module.export = wrap;
