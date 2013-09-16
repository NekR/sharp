(function(window) {
  "use strict";

  var sharp = window.sharp || {};

  sharp.VAR_NAME = '$';
  sharp.HELPERS_VAR = 'h';
  sharp.PARTIALS_VAR = 'p';
  sharp.RUNTIME_VAR = 'r';

  (function sharpRuntime(){
    var entitesMap = {
      '&': '&#38;',
      '<': '&#60;',
      '>': '&#62;',
      '"': '&#34;',
      "'": '&#39;',
      '/': '&#47;'
    };

    var R_MATCH_ENTITES = /&(?!#?\w+;)|<|>|"|'|\//g;

    var encodeHTML = function(str) {
      return str.replace(R_MATCH_ENTITES, function(m) {
        return entitesMap[m] || m;
      });
    };

    sharp.runtime = {
      render: function(tpl, data, partials) {
        tpl = new Function(sharp.RUNTIME_VAR, sharp.HELPERS_VAR, sharp.VAR_NAME, sharp.PARTIALS_VAR, tpl);
        return tpl(sharp.runtime, sharp.runtime.helpers, data, partials || {});
      },
      helpers: {
        test: function() {
          return 'test used';
        }
      },
      interpolate: function(data, safe) {
        var res = ((res = data) == null ? '' : res + '');

        return safe ? res : encodeHTML(res);
      },
    };
  }());

  (function sharpCompiler() {
    var R_UNESCAPE_1 = /\\(['"\\])/g,
      R_UNESCAPE_2 = /[\r\t\n]/g,
      R_EVAL_STR = /%(\w+)%/g,
      OUTPUT_SIGN = 'out',
      VAR_SIGN = 'v',
      TMP_VAR = 'tmp',
      EOL_SIGN = '__EOL__',
      R_STATEMENT = /(@BLOCK_CLOSE)?(@MAIN)(@MAIN|@MULTILINE_COMMENT)?(@IDENTIFIER)?/g,
      R_EXPR_END = /(?:(?!(?:[\s\S](?!(?:@STATEMENT)))*?@EXPR_CLOSE));?/,
      R_EOL = /\r?\n/g,
      R_EOL_OR_EOF = new RegExp('(?:' + EOL_SIGN + ')|$', 'g');

    var consts = {
      MAIN: /#/,
      QUERY: /[\s\S]+/,
      IDENTIFIER: /[A-Za-z_!:][A-Za-z_!:\d]*/,
      BLOCK_OPEN: /\s*\{\s*/,
      BLOCK_CLOSE: /\s*\}\s*/,
      EXPR_OPEN: /\(/,
      EXPR_CLOSE: /\)/,
      MULTILINE_COMMENT: /\*/,
      DELIMITER: /\s+->\s+/,
      STRING: /\\"[^"]*?\\"/,
      OUTPUT: new RegExp(OUTPUT_SIGN)
      /*,
      LOOK_BEHIND: /(?:(@CLOSE)[\s\S]*)?(@PATTERN)/g*/
    },
    operators = {};

    var stream = {
      open: function() {
        return OUTPUT_SIGN + "+='";
      },
      close: function() {
        return "';";
      },
      wrap: function(str) {
        return this.close() + str + this.open();
      }
    },
    wrappers = {
      append: "' + %interpolate%(%data%, %safe%) + '",
      split: "'; out += %interpolate%(%data%, %safe%); out += '"
    },
    slice = Array.prototype.slice,
    hasOwn = Object.prototype.hasOwnProperty;

    var unescape = function(code) {
      return code.replace(R_UNESCAPE_1, '$1').replace(R_UNESCAPE_2, ' ');
    },
    getRegStr = function(reg) {
      return reg.source;
    },
    evalReg = function(reg, flags) {
      if (typeof reg !== 'string') {
        reg = getRegStr(reg);
      }

      reg = reg.replace(/@(\w+)/g, function(input, _const) {
        return getRegStr(consts[_const]);
      });

      reg = new RegExp(reg, typeof flags === 'string' ? flags : 'g');

      return reg;
    },
    doReplace = function(string, from, to, replace) {
      return string.slice(0, from) + replace + string.slice(to);
    },
    evalStr = function(str, data) {
      return str.replace(R_EVAL_STR, function(input, key) {
        return key.split('.').reduce(function(data, key) {
          return data[key];
        }, data);
      });
    };

    consts.STATEMENT = evalReg(R_STATEMENT);

    sharp.compiler = {
      settings: {
        strip: true,
        append: true
      },
      operators: operators
    };

    sharp.compiler.compile = function(str) {
      var settings = sharp.compiler.settings,
        wrapper = settings.append ? wrappers.append : wrappers.split,
        uid = 0,
        mainStr = getRegStr(consts.MAIN);

      str = (settings.strip ? str.replace(/(^|\r?\n)\t* +| +\t*(\r?\n|$)/g, EOL_SIGN)
            .replace(/\r|\n|\t/g, '') : str).replace(/'|"|\\/g, '\\$&');

      var wrap = function(data, unsafe) {
        return evalStr(wrapper, {
          data: data,
          safe: +!unsafe,
          interpolate: interpolateVar
        });
      };

      var compiler = {
        getVar: function(toMap) {
          if (toMap) {
            return this.varMap[toMap] || (this.varMap[toMap] = this.getVar());
          }

          var defined = VAR_SIGN + uid++;

          this.definedVars.push(defined);

          return defined;
        },
        mapQuery: function(query, _var) {
          var operator = compilerOperator;

          if (operator.close) {
            //query = '$.' + query;

            var prev = this.queryMap[query],
              unmap = operator.unmap || (operator.unmap = []);
            
            unmap.push([query, prev || null]);
            this.queryMap[query] = _var;
          }
        },
        evalTokens: function(tokens) {
          var str = stream.open() + makeString(tokens) + stream.close();

          return str;
        },
        query: JSONQuery,
        queryMap: {},
        varMap: {},
        definedVars: [],
        stream: stream
      };

      var interpolateVar = compiler.getVar(sharp.RUNTIME_VAR + '.interpolate'),
        compilerOperator;

      var makeTokens = function() {
        var tokens = [],
          hasIdentifier,
          statementReg = evalReg(R_STATEMENT),
          match,
          matchStr,
          close,
          comment,
          identifier,
          openStack = [],
          tmp,
          index = 0,
          operator,
          pattern,
          patternMatch,
          patternMatchStr,
          main,
          unsafe,
          commentMatch;

        var updateIndex = function() {
          if (index > statementReg.lastIndex) {
            statementReg.lastIndex = index;
          }
        };

        statementReg.lastIndex = 0;

        while (match = statementReg.exec(str)) {
          matchStr = match[0];
          close = match[1];
          main = match[2];
          comment = match[3] || '';
          identifier = match[4] || '';
          tmp = null;

          // console.log(index, str.slice(index, match.index));

          tokens.push({
            type: 'string',
            data: str.slice(index, index = match.index)
          });

          if (comment) {
            if (comment === mainStr) {
              R_EOL_OR_EOF.lastIndex = index;
              commentMatch = R_EOL_OR_EOF.exec(str);
            } else {
              commentMatch = evalReg(/@MULTILINE_COMMENT@MAIN/);
              commentMatch.lastIndex = index;
              commentMatch = commentMatch.exec(str);
            }

            if (commentMatch) {
              tokens.push({
                type: 'comment',
                data: str.slice(index + main.length + comment.length, commentMatch.index)
              });

              index = commentMatch.index + (commentMatch[0] || '').length;
            } else {
              index += matchStr.length;
            }

            updateIndex();
            continue;
          }

          if (identifier[0] === '!') {
            unsafe = true;
            identifier = identifier.slice(1);
          } else {
            unsafe = false;
          }

          hasIdentifier = hasOwn.call(operators, identifier);

          if (close) {
            if (operator = openStack.pop()) {
              tokens.push({
                type: 'close',
                data: operator
              });

              index += matchStr.length;

              tmp = operator = null;
            } else {
              throw new SyntaxError();
            }
          }

          if (!hasIdentifier) {
            updateIndex();
            continue;
          }

          operator = new operators[identifier];
          pattern = '\\s*' + getRegStr(operator.pattern);

          if (operator.close) {
            openStack.push(operator);
            pattern += getRegStr(consts.BLOCK_OPEN);
          } else {
            pattern += getRegStr(R_EXPR_END);
          }

          pattern = evalReg(pattern);
          index = pattern.lastIndex = index + (close ? 0 : matchStr.length);

          patternMatch = pattern.exec(str);

          // console.log(identifier + ':', pattern, patternMatch);

          if (patternMatch && patternMatch.index === index) {
            patternMatchStr = patternMatch[0];
            patternMatch[0] = compiler;

            tokens.push({
              type: 'open',
              data: operator,
              args: patternMatch,
              unsafe: unsafe,
              str: patternMatchStr
            });

            // console.log(identifier + ':', patternMatchStr, pattern);
            index += patternMatchStr.length;
          } else if (!close) {
            index -= matchStr.length;
          }

          updateIndex();
        }

        tokens.push({
          type: 'string',
          data: str.slice(index)
        });

        return tokens;
      },
      makeString = function(tokens) {
        var str = '',
          outflows = [];

        tokens.forEach(function(token) {
          if (outflows.length && !token.data.outflow) {
            var flow = outflows[outflows.length -1];

            flow.tokens.push(token);
            return;
          }

          switch (token.type) {
            case 'string': {
              str += token.data;
            }; break;
            case 'open': {
              var operator = token.data,
                tmp;

              compilerOperator = operator;

              tmp = operator.open.apply(operator, token.args);

              if (operator.outflow) {
                outflows.push({
                  data: tmp,
                  tokens: []
                });
              } else {
                if (!operator.noWrap) {
                  if (operator.interpolation) {
                    tmp = wrap(tmp, operator.hasUnsafe && token.unsafe);
                  } else {
                    tmp = stream.wrap(tmp);
                  }
                }

                str += tmp;
              }
            }; break;
            case 'close': {
              var operator = token.data,
                tmp,
                flow;

              compilerOperator = operator;

              if (operator.outflow && outflows.length) {
                flow = outflows.pop();
              } else {
                flow = null;
              }

              tmp = operator.close(compiler, flow);

              if (!operator.noWrap) {
                tmp = stream.wrap(tmp);
              }

              if (operator.unmap && operator.unmap.length) {
                operator.unmap.forEach(function(arr) {
                  compiler.queryMap[arr[0]] = arr[1];
                });

                operator.unmap = null;
              }

              str += tmp;
            }; break;
            case 'comment': {
              // console.log('comment:', token.data);
            }; break;
          }

          compilerOperator = null;
        });

        return str;
      };

      var tokens = makeTokens();

      str = makeString(tokens);

      str = 'var ' + Object.keys(compiler.varMap).map(function(_var) {
        return  this[_var] + ' = ' + _var;
      }, compiler.varMap) + ';' + "var " + OUTPUT_SIGN + "= '" +
        str + "'; return " + OUTPUT_SIGN + ";";

      str = str.replace(new RegExp(EOL_SIGN, 'g'), ' ')
        .replace(/\n/g, '\\n').replace(/\t/g, '\\t').replace(/\r/g, '\\r')
        .replace(evalReg(/(\s|;|\}|^|\{)@OUTPUT\+='';/), '$1').replace(/\+''/g, '')
        .replace(evalReg(/(\s|;|\}|^|\{)@OUTPUT\+=''\+/),'$1' + OUTPUT_SIGN + '+=');

      console.log(str);

      return str;
    };

    sharp.compiler.addOperator = function(identifier, config) {
      var constructor = function() {};
      constructor.prototype = config;

      operators[identifier] = constructor;
    };

    var partials = {},
    defineOperators = {
      '': {
        pattern: /@EXPR_OPEN(@QUERY?)@EXPR_CLOSE/,
        open: function(compiler, code) {
          return '(' + compiler.query(code) + ')';
        },
        interpolation: true,
        hasUnsafe: true
      },
      '$': {
        pattern: /([a-zA-Z_]+?)@EXPR_OPEN(@QUERY?)@EXPR_CLOSE/,
        open: function(compiler, helpder, args) {
          args = compiler.query(args);

          return sharp.HELPERS_VAR + '.' + helpder + '(' + args + ')';
        },
        interpolation: true,
        hasUnsafe: true
      },
      'each': {
        pattern: /@EXPR_OPEN\s*(@QUERY?)@DELIMITER([\w_]+?)\s*,\s*?([\w_]+?)@EXPR_CLOSE/,
        open: function(compiler, iterate, key, value) {
          var uVar = compiler.getVar(),
            iterVar = compiler.getVar(),
            valVar = compiler.getVar(),
            keysVar = compiler.getVar('Object.keys');

          iterate = compiler.query(iterate);

          compiler.mapQuery(value, valVar)
          compiler.mapQuery(key, uVar);

          var str = 'var %iterVar% = %iterate%;' +
                'if (%iterVar%) {' +
                  '%keysVar%(%iterVar%).forEach(function(%uVar%) {' +
                    '%valVar% = %iterVar%[%uVar%];';

          return evalStr(str, {
            uVar: uVar,
            valVar: valVar,
            iterVar: iterVar,
            keysVar: keysVar,
            iterate: iterate
          });
        },
        close: function() {
          return '});}';
        }
      },
      'for': {
        pattern: /@EXPR_OPEN\s*(@QUERY?)\s+->\s+([\w_]+?)\s*(?:,\s*?([\w_]+?))?@EXPR_CLOSE/,
        open: function(compiler, iterate, value, index) {
          var uVar = compiler.getVar(),
            iterVar = compiler.getVar(),
            lenVar = compiler.getVar(),
            valVar = compiler.getVar();

          iterate = compiler.query(iterate);

          compiler.mapQuery(value, valVar)
          compiler.mapQuery(index, uVar);


          var str = 'var %iterVar% = %iterate%;' +
                'if (%iterVar%) {' +
                  'for (var %uVar% = 0, %lenVar% = %iterVar%.length; %uVar% < %lenVar%; %uVar%++) {' +
                    '%valVar% = %iterVar%[%uVar%];';

          return evalStr(str, {
            uVar: uVar,
            iterVar: iterVar,
            lenVar: lenVar,
            valVar: valVar,
            iterate: iterate
          });
        },
        close: function() {
          return '}}';
        }
      },
      'if': {
        pattern: /@EXPR_OPEN(@QUERY?)@EXPR_CLOSE/,
        open: function(compiler, expr) {
          return 'if (' + compiler.query(expr) + ') {';
        },
        close: function() {
          return '}';
        },
      },
      'else': {
        pattern: /(?:)/,
        open: function() {
          return 'else {'
        },
        close: function() {
          return '}';
        }
      },
      'elseif': {
        pattern: /@EXPR_OPEN(@QUERY?)@EXPR_CLOSE/,
        open: function(compiler, expr) {
          return "else if (" + compiler.query(expr) + ") {";
        },
        close: function() {
          return '}';
        }
      },
      'json': {
        pattern: /@EXPR_OPEN(@QUERY?)@EXPR_CLOSE/,
        open: function(compiler, expr) {
          var stringifyVar = compiler.getVar('JSON.stringify');

          return stringifyVar + '(' + compiler.query(expr) + ')';
        },
        interpolation: true,
        hasUnsafe: true
      },
      'def': {
        pattern: /@EXPR_OPEN(@QUERY?)@EXPR_CLOSE/,
        open: function(compiler, name) {
          name = compiler.query(name);
          name = new Function('return ' + name)();

          return {
            name: name
          };
        },
        close: function(compiler, context) {
          var name = context.data.name;

          partials[name] = context;
          return '';
        },
        outflow: true
      },
      'use': {
        pattern: /@EXPR_OPEN(@QUERY?)@EXPR_CLOSE/,
        open: function(compiler, name) {
          name = compiler.query(name);
          name = new Function('return ' + name)();

          name = partials[name];

          if (name) {
            name = compiler.evalTokens(name.tokens);
            return name;
          }

          return '';
        }
      }
    };

    Object.keys(defineOperators).forEach(function(identifier) {
      var config = defineOperators[identifier];

      sharp.compiler.addOperator(identifier, config);
    });

    function JSONQuery(query, obj, args, context) {
      var depth = 0,
        strings = [],
        compiler = this,
        queryMap = this.queryMap;

      query = unescape(query);

      query = query.replace(/"(\\.|[^"\\])*"|'(\\.|[^'\\])*'|[\[\]]/g, function(t) {
        depth += t === '[' ? 1 : (t === ']' ? -1 : 0); // keep track of bracket depth

        return (t === ']' && depth > 0) ? '`]' : // we mark all the inner brackets as skippable
            (t[0] === '"' || t[0] == "'") ? '`' + (strings.push(t) - 1) : t; // and replace all the strings
      });

      query = query.replace(/([^<>=]=)([^=])/g, '$1=$2'); // change the equals to comparisons except operators ==, <=, >=

      query = query.replace(/(@|(?:\.\s*?)|\$)?([a-zA-Z_]+)(\s*:)?/g, function(str, sign, identifier, colon) {
        if (colon) {
          return (sign || '') + identifier + colon;
        }

        if (sign !== '.' && sign !== '@') {
          if (!str.match(/^(\$([\da-zA-Z_]*)|Math|Date||parseInt|parseFloat|isNaN|isFinite|true|false|null)$/)) {
            sign = '@';
          }
        }

        if (sign === '@') {
          if (hasOwn.call(queryMap, identifier)) {
            return queryMap[identifier];
          }

          return sharp.VAR_NAME + '.' + identifier;
        }

        if (sign === '$') {
          return sharp.HELPERS_VAR + '.' + identifier;
        }

        return (sign || '') + identifier;
      });

      /*query = query.replace(/\$(\d+|[a-z_][a-z0-9_]*)/gi, function(str, arg) {
        return isFinite(arg) ? '_[' + arg + ']' : '_.' + arg;
      });*/

      query = query.replace(/`([0-9]+|\])/g, function(t, a) {
        //restore the strings
        return a === ']' ? ']' : strings[a];
      });

      return query;
    };
  }());

  window.sharp = sharp;
}(this));