// Using Rework, not PostCSS, because Rework does reformat whitespace.

var rework = require('rework');
var fs = require('fs');
var color = require('color-parser');
var diff = require('diff');
var _ = require('lodash');

function parseColors(value) {
  // Throw everything at colorString, and see what sticks.
  return value.replace(/(#[0-9a-fA-F]{3,6}|rgba?\([0-9,\s]+\)|[^\s]+)/g, function(match){
    var colorMatch;

    try {
      colorMatch = colorString(match);
    } catch (e) {}

    return colorMatch || match;
  });
}

function colorString(value) {
  var c = color(value);
  if (c) {
    c = 'rgba('+c.r+', '+c.g+', '+c.b+', '+(c.a||1)+')';
  }
  return c;
}

function floatString(value) {
  return value.replace(/(.|^)\.([0-9]+)/g, function(match, left, right){
    // TODO: Don't do all this string mojo on numbers.

    var digit = !isNaN(parseInt(left.trim(), 10));
    return (digit ? left : left+'0') + '.' + right.replace(/0+$/, '');
  });
}

function normalize(root, rw) {
  // TODO: Use the source position to inform our diff?

  var filterRule = function(rule){
    if (rule.declarations) {
      return rule.declarations.length > 0;
    }
    return rule.type !== 'comment';
  };

  var processRule = function(rule) {
    if (rule.selectors) {
      rule.selectors = rule.selectors.map(function(selector){
        return selector
          .replace(/\s+/g, ' ')
          .replace(/\s*([+>])\s*/g, ' $1 ');
      });
    }

    if (rule.declarations && rule.declarations.length) {
      rule.declarations.forEach(function(declaration){
        if (declaration.value) {
          declaration.value = floatString(declaration.value);
          declaration.value = parseColors(declaration.value);
          declaration.value = declaration.value
            .replace(/,\s*/g, ', ')
            .replace(/'/g, '"');
        }
      });
    }

    if (rule.rules && rule.rules.length) {
      rule.rules = rule.rules.filter(filterRule);
      rule.rules.forEach(processRule);
    }
  }

  root.rules = root.rules.filter(filterRule);
  root.rules.forEach(processRule);
}

var extensions = {
  compass: require('./lib/extensions/compass')
};

module.exports = function(test, control, options){
  options = options || {};
  var label = options.label;
  var output = options.output;
  var usedExtensions = (options.extensions||'').split(',')

  var processed = _.mapValues({
    test: test,
    control: control
  }, function(path) {
    var rw = rework(fs.readFileSync(path).toString()).use(normalize);
    _.chain(usedExtensions)
      .map(function(e){ return extensions[e]; })
      .compact()
      .each(function(e){ rw.use(e); });

    var css = rw.toString();
    var selectors = _.chain(rw.obj.stylesheet.rules)
      .map('selectors')
      .flatten()
      .value();

    if (output) {
      var normalizedPath = path.replace('.css', '-normalized.css');
      fs.writeFileSync(normalizedPath, css);
    }

    return {
      selectors: selectors,
      css: css
    }
  });

  return {
    "diff": diff.createPatch(label || test, processed.control.css, processed.test.css),
    "selectors": {
      added: _.difference(processed.test.selectors, processed.control.selectors),
      removed: _.difference(processed.control.selectors, processed.test.selectors)
    },
    "control": processed.control.css,
    "test": processed.test.css
  }
}
