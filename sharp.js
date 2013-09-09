(function(window) {
  "use strict";

  var sharp = window.sharp || {};

  sharp.runtime = {
    render: function(tpl, data, partials) {
      return tpl(sharp.runtime.helpers.encodeHTML, data);
    },
    helpers: {
      encodeHTML: function(str) {
        return str.replace(R_MATCH_ENTITES, function(m) {
          return entitesMap[m] || m;
        });
      }
    }
  };

  sharp.compiler = {
    settings: {
      varname: '$',
      strip: true,
      append: true
    }
  };

  var OUTPUT_SIGN = 'out',
    VAR_SIGN = 'v',
    TMP_VAR = 'tmp',
    STATEMENT = /(@BLOCK_CLOSE)?(@MAIN)(@IDENTIFIER)?/g,
    consts = {
      MAIN: /#/,
      EXPR: /[\s\S]+/,
      IDENTIFIER: /[A-Za-z_!:][A-Za-z_!:\d]*/,
      BLOCK_OPEN: /\s*\{\s*/,
      BLOCK_CLOSE: /\s*\}\s*/,
      OUTPUT: new RegExp(OUTPUT_SIGN)
      /*,
      LOOK_BEHIND: /(?:(@CLOSE)[\s\S]*)?(@PATTERN)/g*/
    },
    tokens = {
      '': {
        pattern: /\{(@EXPR?)\}/,
        open: function(compiler, code) {
          return compiler.query(code);
        },
        interpolation: true,
        hasUnsafe: true
      },
      'each': {
        pattern: /\{\s*(@EXPR?)\s+->\s+([\w_]+?)\s*,\s*?([\w_]+?)\}?/,
        open: function(compiler, iterate, key, value) {
          var uVar = compiler.getVar(),
            iterVar = compiler.getVar(),
            valVar = compiler.getVar();

          iterate = compiler.query(iterate);

          compiler.mapQuery(value, valVar)
          compiler.mapQuery(key, uVar);

          var str = "var %iterVar% = %iterate%; \
                if (%iterVar%) {\
                  Object.keys(%iterVar%).forEach(function(%uVar%) {\
                    %valVar% = %iterVar%[%uVar%];";

          return evalStr(str, {
            uVar: uVar,
            valVar: valVar,
            iterVar: iterVar,
            iterate: iterate
          });
        },
        close: function() {
          return "});}";
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


          var str = "var %iterVar% = %iterate%;\
                if (%iterVar%) {\
                  for (var %uVar% = 0, %lenVar% = %iterVar%.length; %uVar% < %lenVar%; %uVar%++) {\
                    %valVar% = %iterVar%[%uVar%];";

          return evalStr(str, {
            uVar: uVar,
            iterVar: iterVar,
            lenVar: lenVar,
            valVar: valVar,
            iterate: iterate
          });
        },
        close: function() {
          return "}}";
        }
      },
      'if': {
        pattern: /\{(@EXPR?)\}/,
        open: function(compiler, expr) {
          return "if (" + compiler.query(expr) + ") {";
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
      json: {
        pattern: /\{(@EXPR?)\}/,
        open: function(compiler, expr) {
          return 'JSON.stringify(' + compiler.query(expr) + ')';
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
    wrap: function(wrapper, data, unsafe) {
      return evalStr(unsafe ? wrapper.unsafe : wrapper.safe, {
        data: data,
        tmp: TMP_VAR
      });
    }
  },
  wrappers = {
    append: {
      safe: "' + encodeHTML(((%tmp% = %data%) == null ? '' : %tmp%) + '') + '",
      unsafe: "' + (((%tmp% = %data%) == null ? '' : %tmp%) + '') + '"
    },
    split: {
      safe: "'; out += encodeHTML(((%tmp% = %data%) == null ? '' : %tmp%) + ''); out += '",
      unsafe: "'; out += (((%tmp% = %data%) == null ? '' : %tmp%) + ''); out += '"
    }
  },
  entitesMap = {
    "&": "&#38;",
    "<": "&#60;",
    ">": "&#62;",
    '"': '&#34;',
    "'": '&#39;',
    "/": '&#47;'
  },
  slice = Array.prototype.slice,
  hasOwn = Object.prototype.hasOwnProperty;

  var R_MATCH_ENTITES = /&(?!#?\w+;)|<|>|"|'|\//g,
    R_UNESCAPE_1 = /\\(['"\\])/g,
    R_UNESCAPE_2 = /[\r\t\n]/g,
    R_EVAL_STR = /%(\w+)%/g;

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

  sharp.compiler.compile = function(str) {
    var settings = sharp.compiler.settings,
      wrapper = settings.append ? wrappers.append : wrappers.split,
      uid = 0,
      compiler;

    str = (settings.strip ? str.replace(/(^|\r|\n)\t* +| +\t*(\r|\n|$)/g, ' ')
          .replace(/\r|\n|\t|\/\*[\s\S]*?\*\//g, '') : str).replace(/'|"|\\/g, '\\$&');

    (function() {
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
        unsafe;

      compiler = {
        getVar: function() {
          return VAR_SIGN + uid++;
        },
        query: JSONQuery,
        mapQuery: function(who, by) {
          if (token.close) {
            //who = '$.' + who;

            var prev = this.queryMap[who],
              unmap = token.unmap || (token.unmap = []);
            
            unmap.push([who, prev || null]);
            this.queryMap[who] = by;
          }
        },
        queryMap: {}
      };

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
              tmp = stream.close() + tmp +  stream.open();
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
              tmp = stream.wrap(wrapper, tmp, token.hasUnsafe && unsafe);
            } else {
              tmp = stream.close() + tmp + stream.open();
            }
          }

          str = doReplace(
            str, index,
            patternStart + patternMatchStr.length,
            tmp
          );
        }
      }
    }());

    str = "var " + TMP_VAR + ", " + OUTPUT_SIGN + "= '" + str + "'; return " + OUTPUT_SIGN + ";";

    str = str.replace(/\n/g, '\\n').replace(/\t/g, '\\t').replace(/\r/g, '\\r')
      .replace(evalReg(/(\s|;|\}|^|\{)@OUTPUT\+='';/), '$1').replace(/\+''/g, '')
      .replace(evalReg(/(\s|;|\}|^|\{)@OUTPUT\+=''\+/),'$1' + OUTPUT_SIGN + '+=');

    console.log(str);

    try {
      return new Function('encodeHTML', settings.varname, str);
    } catch (e) {
      if (typeof console !== 'undefined') {
        console.log("Could not create a template function: " + str);
      }

      throw e;
    }
  };

  window.sharp = sharp;

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
          (t.charAt(0) === '"' || t.charAt(0) == "'") ? '`' + (strings.push(t) - 1) : t; // and replace all the strings
    });

    query = query.replace(/([^<>=]=)([^=])/g, '$1=$2') // change the equals to comparisons except operators ==, <=, >=

    query = query.replace(/(@|\.)?\s*([a-zA-Z_]+)(\s*:)?/g, function(str, sign, identifier) {
      if (sign !== '.' && sign !== '@') {
        if (!str.match(/:|^(\$([\da-zA-Z_]*)|Math|Date|new Date|parseInt|parseFloat|isNaN|isFinite|true|false|null)$/)) {
          sign = '@';
        }
      }

      if (sign === '@') {
        if (hasOwn.call(queryMap, identifier)) {
          return queryMap[identifier];
        }

        return '$.' + identifier;
      }

      return sign + identifier;
    });

    query = query.replace(/\$(\d+|[a-z_][a-z0-9_]*)/gi, function(str, arg) {
      return isFinite(arg) ? '_[' + arg + ']' : '_.' + arg;
    });

    query = query.replace(/`([0-9]+|\])/g, function(t, a) {
      //restore the strings
      return a === ']' ? ']' : strings[a];
    });

    return query;
  };
}(this));