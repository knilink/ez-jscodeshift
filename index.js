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
  if (path.length === 0) {
    return value;
  }
  let target = ast;
  const _path = path.slice(0, -1);
  const prop = path[path.length - 1];
  for (const i of _path) {
    if (!target) return false;
    target = target[i];
  }
  target[prop] = value;
  return ast;
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
    let result = [];
    for (const childName in matcher) {
      result = [...result, ...bindCustomMatcher(types, matcher[childName], [...path, childName])];
    }
    return result;
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

  const bindingName =
    (types.namedTypes.Identifier.check(ast) && ast.name) ||
    (types.namedTypes.BlockStatement.check(ast) && ast.innerComments[0].value) ||
    (types.namedTypes.TemplateLiteral.check(ast) && ast.quasis[0].value.raw);

  if (bindingName in bindings) {
    return {
      matcher: bindings[bindingName].matcher,
      bindings: {
        ...bindingsRes,
        [bindingName]: {
          srcPath: path,
          ...bindings[bindingName],
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

  const bindingName =
    (types.namedTypes.Identifier.check(ast) && ast.name) ||
    (types.namedTypes.BlockStatement.check(ast) && ast.innerComments[0].value) ||
    (types.namedTypes.TemplateLiteral.check(ast) && ast.quasis[0].value.raw);

  if (bindingName in bindings) {
    return {
      bindings: {
        ...bindingsRes,
        [bindingName]: {
          ...bindings[bindingName],
          dstPaths: [...(bindings[bindingName].dstPaths || []), path],
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
      if (name[0] === '{' && name[name.length - 1] === '}') {
        const blockName = name.slice(1, -1);
        bindings[blockName] = { matcher: customMatcher };
        source += `{/*${blockName}*/}` + code[+i + 1];
      } else if (name[0] === '`' && name[name.length - 1] === '`') {
        const templateName = name.slice(1, -1);
        bindings[templateName] = { matcher: customMatcher };
        source += name + code[+i + 1];
      } else {
        bindings[name] = { matcher: customMatcher };
        source += name + code[+i + 1];
      }
    }

    let _ast = j(source, options).get('program', 'body', 0).value;
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
    const isArray = j.types.builtInTypes.array;

    let targetBindings = {};
    let targetSourceCode = code[0];
    for (const i in args) {
      const [name, setter] = isArray.check(args[i])
        ? args[i]
        : isFunction.check(args[i])
        ? [randVarName(), args[i]]
        : [args[i]];

      if (name[0] === '{' && name[name.length - 1] === '}') {
        const blockName = name.slice(1, -1);
        targetBindings[blockName] = { setter };
        targetSourceCode += `{/*${blockName}*/}` + code[+i + 1];
      } else if (name[0] === '`' && name[name.length - 1] === '`') {
        const templateName = name.slice(1, -1);
        targetBindings[templateName] = { setter };
        targetSourceCode += name + code[+i + 1];
      } else {
        targetBindings[name] = { setter };
        targetSourceCode += name + code[+i + 1];
      }
    }

    const result = this.replaceWith((path) => {
      let targetAst = j(targetSourceCode, options).get('program', 'body', 0).value;
      // mark
      if (targetAst.type === 'ExpressionStatement') {
        targetAst = targetAst.expression;
      }
      targetBindings = bindDst(j.types, targetAst, targetBindings).bindings;

      const value = path.value;

      let bindingResult = {};
      if (value.__ezBindingContext) {
        bindingResult = value.__ezBindingContext;
      } else {
        for (const i in bindings) {
          bindingResult[i] = {
            value: path.get(...bindings[i].srcPath).value,
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
      }
      for (const i in targetBindings) {
        for (const dstPath of targetBindings[i].dstPaths) {
          if (targetBindings[i].setter) {
            const newNode = targetBindings[i].setter(bindingResult, path);
            if (newNode) {
              targetAst = set(targetAst, dstPath, newNode);
            }
          } else if (i in bindingResult) {
            targetAst = set(targetAst, dstPath, bindingResult[i].value);
          }
        }
      }
      if (targetAst) {
        targetAst.comments = value.comments;
      }
      targetAst.__ezBindingContext = bindingResult;
      return targetAst;
    });

    // mark
    // result.__ezContext = this.__ezContext;
    result.ezReplaceWith = mutationMethods.ezReplaceWith;
    return result;
  },
};

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
