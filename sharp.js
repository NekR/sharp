(function(window) {
  "use strict";

  var sharp = window.sharp || {};

  sharp.compiler = {
    settings: {
      varname: '$',
      strip: true,
      append: true
    }
  };

  var OUTPUT_SIGN = 'out',
    VAR_SIGN = 'v',
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
        open: function(wrapper, code) {
          return wrapper.start + JSONQuery(unescape(code)) + wrapper.end;
        },
        noWrap: true
      },
      'each': {
        pattern: /\{\s*(@EXPR?)\s+->\s+([\w_]+?)\s*,\s*?([\w_]+?)\}?/,
        open: function(wrapper, iterate, key, value) {
          var uid = wrapper.getUid(),
            uvar = 'k' + (++uid),
            itervar = 'a' + uid;

          iterate = JSONQuery(unescape(iterate));

          return "var " + itervar + "=" + iterate + ";if(" + itervar +"){for(var " +
            uvar + " in " + itervar  + "){if(" + itervar + ".hasOwnProperty(" + uvar +
              ")){ $." + value + "=" + itervar + "[" + uvar + "];$." + key + " = " + uvar + ";";
        },
        close: function() {
          return "}}}";
        }
      },
      'for': {
        pattern: /\{\s*(@EXPR?)\s+->\s+([\w_]+?)\s*,\s*?([\w_]+?)\}?/,
        open: function(wrapper, iterate, value, index) {
          var uid = wrapper.getUid(),
            uvar = 'i' + (++uid),
            itervar = 'a' + uid,
            lenvar = 'l' + uid;

          iterate = JSONQuery(unescape(iterate));

          return "var " + itervar + "=" + iterate + ";if(" + itervar +"){for(var " +
            uvar + " = 0, " + lenvar + " = " + itervar + ".length;" + uvar + "<" + lenvar +
            ";" + uvar + "++){if(" + itervar + ".hasOwnProperty(" + uvar +
              ")){ $." + value + "=" + itervar + "[" + uvar + "];$." + index + " = " + uvar + ";";
        },
        close: function() {
          return "}}}";
        }
      },
      'if': {
        pattern: /\{(@EXPR?)\}/,
        open: function(wrapper, expr) {
          return "if (" + JSONQuery(unescape(expr)) + ") {";
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
        open: function(wrapper, expr) {
          return "else if (" + JSONQuery(unescape(expr)) + ") {";
        },
        close: function() {
          return '}';
        }
      }
    };

  var engine = {
    open: function() {
      return OUTPUT_SIGN + "+='";
    },
    close: function() {
      return "';";
    }
  };

  var wrappers = {
    append: { 
      unsafeStart: "'+(",
      unsafeEnd: ")+'",
      start: "'+encodeHTML(((tmp = ",
      end: ") == null ? '' : tmp) + '')+'"
    },
    split: {
      safe: "';out+=encodeHTML(((tmp = %data%) == null ? '' : tmp) + '');out+='",
      unsafeStart: "';out+=(",
      unsafeEnd: ");out+='",
      start: "';out+=encodeHTML(((tmp = ",
      end: ") == null ? '' : tmp) + '');out+='"
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
  slice = Array.prototype.slice;

  var R_MATCH_ENTITES = /&(?!#?\w+;)|<|>|"|'|\//g,
    R_UNESCAPE_1 = /\\(['"\\])/g,
    R_UNESCAPE_2 = /[\r\t\n]/g;

  var encodeHTML = function(str) {
    return str.replace(R_MATCH_ENTITES, function(m) {
      return entitesMap[m] || m;
    });
  },
  unescape = function(code) {
    return code.replace(R_UNESCAPE_1, '$1').replace(R_UNESCAPE_2, ' ');
  },
  getRegStr = function(reg) {
    /*reg += '';

    var start = reg.indexOf('/') + 1,
      end = reg.lastIndexOf('/');
    
    return reg.slice(start, end);*/

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
    return string.slice(0, from) + replace +
      string.slice(to);
  };

  sharp.compiler.compile = function(str) {
    var settings = sharp.compiler.settings,
      wrapper = settings.append ? wrappers.append : wrappers.split,
      uid = 0;

    wrapper = Sync.extend({
      getUid: function() {
        return uid++;
      }
    }, wrapper, engine);

    str = ("var tmp; var " + OUTPUT_SIGN + "='" +
      (settings.strip ? str.replace(/(^|\r|\n)\t* +| +\t*(\r|\n|$)/g, ' ')
          .replace(/\r|\n|\t|\/\*[\s\S]*?\*\//g, '') : str)
      .replace(/'|"|\\/g, '\\$&'));

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
        main;

      statementReg.lastIndex = 0;

      while (match = statementReg.exec(str)) {
        matchStr = match[0];
        close = match[1];
        main = match[2];
        identifier = match[3] || '';
        index = match.index;
        tmp = null;

        if (close) {
          if (token = openStack.pop()) {
            tmp = token.close();

            if (!token.noWrap) {
              tmp = engine.close() + tmp +  engine.open();
            }

            token = tmp;

            str = doReplace(str, index, index + close.length + main.length, token);
            index += token.length;
            token = null;
          } else {
            throw new SyntaxError();
          }
        }
        if (!tokens.hasOwnProperty(identifier)) {
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
          index + (close ? identifier.length : main.length + identifier.length);
        patternMatch = pattern.exec(str);

        if (patternMatch && patternMatch.index === patternStart) {
          patternMatchStr = patternMatch[0];
          tmp = [wrapper].concat(patternMatch.slice(1));
          tmp = token.open.apply(token, tmp);

          if (!token.noWrap) {
            tmp = engine.close() + tmp + engine.open();
          }

          str = doReplace(
            str, index,
            patternStart + patternMatchStr.length,
            tmp
          );
        }
      }
    }());

    str += "';return " + OUTPUT_SIGN + ";";

    str = str.replace(/\n/g, '\\n').replace(/\t/g, '\\t').replace(/\r/g, '\\r')
      .replace(evalReg(/(\s|;|\}|^|\{)@OUTPUT\+='';/), '$1').replace(/\+''/g, '')
      .replace(evalReg(/(\s|;|\}|^|\{)@OUTPUT\+=''\+/),'$1' + OUTPUT_SIGN + '+=');

    console.log('-- fn --');
    console.log(str);
    console.log('-- end --');

    try {
      return (new Function('encodeHTML', settings.varname, str))
       .bind(null, encodeHTML);
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
      executor;
    query = query.replace(/"(\\.|[^"\\])*"|'(\\.|[^'\\])*'|[\[\]]/g, function(t) {
      depth += t === '[' ? 1 : (t === ']' ? -1 : 0); // keep track of bracket depth

      return (t === ']' && depth > 0) ? '`]' : // we mark all the inner brackets as skippable
          (t.charAt(0) === '"' || t.charAt(0) == "'") ? '`' + (strings.push(t) - 1) : t; // and replace all the strings
    });

    // need to change to more savable match
    /*query.replace(/(\]|\)|push|pop|shift|splice|sort|reverse)\s*\(/, function(){
      throw new SyntaxError("Unsafe function call");
    });*/

    query = query.replace(/([^<>=]=)([^=])/g, '$1=$2') // change the equals to comparisons except operators ==, <=, >=

    query = query.replace(/(@|\.)?\s*([a-zA-Z\$_]+)(\s*:)?/g, function(str, sign, identifier) {
      return (sign === '.' ? sign : // leave .prop alone
        sign === '@' ? /*'_ctx.'*/ '$.' : // the reference to the current object; is unused now
        (str.match(/:|^(\$([\da-zA-Z_]*)|Math|true|false|null)$/) ? '' : '$.')) + identifier; // plain names should be properties of root...
        //unless they are a label in object initializer
    });

    query = query.replace(/\$(\d+|[a-z_][a-z0-9_]*)/gi, function(str, arg) {
      return isFinite(arg) ? '_[' + arg + ']' : '_.' + arg;
    });

    query = query.replace(/`([0-9]+|\])/g, function(t, a) {
      //restore the strings
      return a === ']' ? ']' : strings[a];
    });

    return query;

    //executor = new Function('$', '_', '"use strict"; return (' + query + ');');

    //return obj ? executor(obj, args) : executor;
  };
}(this));