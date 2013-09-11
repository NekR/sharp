(function(window) {
  "use strict";

  var sharp = window.sharp || {};

  sharp.VAR_NAME = '$';
  sharp.HELPERS = 'h';

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

    sharp.runtime = {
      render: function(tpl, data, partials) {
        tpl = new Function(sharp.HELPERS, sharp.VAR_NAME, tpl);
        return tpl(sharp.runtime.helpers, data);
      },
      helpers: {
        encodeHTML: function(str) {
          return str.replace(R_MATCH_ENTITES, function(m) {
            return entitesMap[m] || m;
          });
        }
      }
    };
  }());

  (function sharpCompiler() {
    var consts = {
        MAIN: /#/,
        EXPR: /[\s\S]+/,
        IDENTIFIER: /[A-Za-z_!:][A-Za-z_!:\d]*/,
        BLOCK_OPEN: /\s*\{\s*/,
        BLOCK_CLOSE: /\s*\}\s*/,
        EXPR_OPEN: /\{/,
        EXPR_CLOSE: /\}(?![\s\S]*?\};);?/,
        OUTPUT: new RegExp(OUTPUT_SIGN)
        /*,
        LOOK_BEHIND: /(?:(@CLOSE)[\s\S]*)?(@PATTERN)/g*/
      },
      tokens = {
        '': {
          pattern: /@EXPR_OPEN(@EXPR?)@EXPR_CLOSE/,
          open: function(compiler, code) {
            return compiler.query(code);
          },
          interpolation: true,
          hasUnsafe: true
        },
        'each': {
          pattern: /\{\s*(@EXPR?)\s+->\s+([\w_]+?)\s*,\s*?([\w_]+?)\}/,
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
          pattern: /\{\s*(@EXPR?)\s+->\s+([\w_]+?)\s*(?:,\s*?([\w_]+?))?\}/,
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
          pattern: /\{(@EXPR?)\}/,
          open: function(compiler, expr) {
            return 'if (' + compiler.query(expr) + ') {';
          },
          close: function() {
            return '}';
          }
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
          pattern: /\{(@EXPR?)\}/,
          open: function(compiler, expr) {
            return "else if (" + compiler.query(expr) + ") {";
          },
          close: function() {
            return '}';
          }
        },
        'json': {
          pattern: /@EXPR_OPEN(@EXPR?)@EXPR_CLOSE/,
          open: function(compiler, expr) {
            var stringifyVar = compiler.getVar('JSON.stringify');

            return stringifyVar + '(' + compiler.query(expr) + ')';
          },
          interpolation: true,
          hasUnsafe: true
        }
      };

    var stream = {
      open: function() {
        return OUTPUT_SIGN + "+='";
      },
      close: function() {
        return "';";
      },
      wrap: function(str) {
        return this.close() + str + this.open();
      },
      interpolate: "function(data, safe) {" +
        "var res = ((res = data) == null ? '' : res) + ''; return safe ? res : %encodeHTML%(res);}"
    },
    wrappers = {
      append: "' + %interpolate%(%data%, %safe%) + '",
      split: "'; out += %interpolate%(%data%, %safe%); out += '"
    },
    slice = Array.prototype.slice,
    hasOwn = Object.prototype.hasOwnProperty;

    var R_UNESCAPE_1 = /\\(['"\\])/g,
      R_UNESCAPE_2 = /[\r\t\n]/g,
      R_EVAL_STR = /%(\w+)%/g,
      OUTPUT_SIGN = 'out',
      VAR_SIGN = 'v',
      TMP_VAR = 'tmp',
      STATEMENT = /(@BLOCK_CLOSE)?(@MAIN)(@IDENTIFIER)?/g;

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

    sharp.compiler = {
      settings: {
        strip: true,
        append: true
      },
      tokens: tokens
    };

    sharp.compiler.compile = function(str) {
      var settings = sharp.compiler.settings,
        wrapper = settings.append ? wrappers.append : wrappers.split,
        uid = 0,
        compiler;

      var statementReg = evalReg(STATEMENT),
        match,
        matchStr,
        close,
        identifier,
        openStack = [],
        tmp,
        index,
        token,
        pattern,
        patternMatch,
        patternStart,
        patternMatchStr,
        main,
        unsafe,
        interpolateVar,
        encodeHTMLVar;

      var wrap = function(data, unsafe) {
        return evalStr(wrapper, {
          data: data,
          safe: !unsafe,
          interpolate: interpolateVar
        });
      };

      str = (settings.strip ? str.replace(/(^|\r|\n)\t* +| +\t*(\r|\n|$)/g, ' ')
            .replace(/\r|\n|\t|\/\*[\s\S]*?\*\//g, '') : str).replace(/'|"|\\/g, '\\$&');

      compiler = {
        getVar: function(toMap) {
          if (toMap) {
            return this.varMap[toMap] || (this.varMap[toMap] = this.getVar());
          }

          var defined = VAR_SIGN + uid++;

          this.definedVars.push(defined);

          return defined;
        },
        mapQuery: function(who, by) {
          if (token.close) {
            //who = '$.' + who;

            var prev = this.queryMap[who],
              unmap = token.unmap || (token.unmap = []);
            
            unmap.push([who, prev || null]);
            this.queryMap[who] = by;
          }
        },
        query: JSONQuery,
        queryMap: {},
        varMap: {},
        definedVars: []
      };

      encodeHTMLVar = compiler.getVar(sharp.HELPERS + '.encodeHTML');
      interpolateVar = compiler.getVar(evalStr(stream.interpolate, {
        encodeHTML: encodeHTMLVar
      }));

      statementReg.lastIndex = 0;

      while (match = statementReg.exec(str)) {
        matchStr = match[0];
        close = match[1];
        main = match[2];
        identifier = match[3] || '';
        index = match.index;
        tmp = null;

        if (identifier[0] === '!') {
          unsafe = true;
          identifier = identifier.slice(1);
        } else {
          unsafe = false;
        }

        if (close) {
          if (token = openStack.pop()) {
            tmp = token.close();

            if (!token.noWrap) {
              tmp = stream.wrap(tmp);
            }

            if (token.unmap && token.unmap.length) {
              token.unmap.forEach(function(arr) {
                compiler.queryMap[arr[0]] = arr[1];
              });

              token.unmap = null;
            }

            str = doReplace(str, index, index + close.length + main.length, tmp);
            index += tmp.length;
            tmp = token = null;
          } else {
            throw new SyntaxError();
          }
        }

        if (!hasOwn.call(tokens, identifier)) {
          continue;
        }

        token = tokens[identifier];
        pattern = '\\s*' + getRegStr(token.pattern);

        if (token.close) {
          openStack.push(token);
          pattern += getRegStr(consts.BLOCK_OPEN);
        }

        pattern = evalReg(pattern);
        pattern.lastIndex = patternStart =
          index + (close ? identifier.length : main.length + identifier.length) + unsafe;
        patternMatch = pattern.exec(str);

        if (patternMatch && patternMatch.index === patternStart) {
          patternMatchStr = patternMatch[0];
          tmp = [compiler].concat(patternMatch.slice(1));
          tmp = token.open.apply(token, tmp);

          if (!token.noWrap) {
            if (token.interpolation) {
              tmp = wrap(tmp, token.hasUnsafe && unsafe);
            } else {
              tmp = stream.wrap(tmp);
            }
          }

          str = doReplace(
            str, index,
            patternStart + patternMatchStr.length,
            tmp
          );
        }
      }

      str = 'var ' + Object.keys(compiler.varMap).map(function(_var) {
        return  this[_var] + ' = ' + _var;
      }, compiler.varMap) + ';' + "var " + OUTPUT_SIGN + "= '" +
        str + "'; return " + OUTPUT_SIGN + ";";

      str = str.replace(/\n/g, '\\n').replace(/\t/g, '\\t').replace(/\r/g, '\\r')
        .replace(evalReg(/(\s|;|\}|^|\{)@OUTPUT\+='';/), '$1').replace(/\+''/g, '')
        .replace(evalReg(/(\s|;|\}|^|\{)@OUTPUT\+=''\+/),'$1' + OUTPUT_SIGN + '+=');

      return str;
    };

    function JSONQuery(query, obj, args, context) {
      var depth = 0,
        strings = [],
        executor,
        compiler = this,
        queryMap = this.queryMap;

      query = unescape(query);

      query = query.replace(/"(\\.|[^"\\])*"|'(\\.|[^'\\])*'|[\[\]]/g, function(t) {
        depth += t === '[' ? 1 : (t === ']' ? -1 : 0); // keep track of bracket depth

        return (t === ']' && depth > 0) ? '`]' : // we mark all the inner brackets as skippable
            (t[0] === '"' || t[0] == "'") ? '`' + (strings.push(t) - 1) : t; // and replace all the strings
      });

      query = query.replace(/([^<>=]=)([^=])/g, '$1=$2'); // change the equals to comparisons except operators ==, <=, >=

      query = query.replace(/(@|\.)?\s*([a-zA-Z_]+)(\s*:)?/g, function(str, sign, identifier, colon) {
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