"use strict";
var TemplateVisitor = require("./template_visitor")["default"];
var processOpcodes = require("./utils").processOpcodes;
var forEach = require("../utils").forEach;
var isHelper = require("../ast").isHelper;
var buildString = require("../builders").buildString;
var buildHashFromAttributes = require("../html-parser/helpers").buildHashFromAttributes;
var buildHashFromAttributes = require("../html-parser/helpers").buildHashFromAttributes;

function detectIsElementChecked(element){
  for (var i=0, len=element.attributes.length;i<len;i++) {
    if (element.attributes[i].name === 'checked') {
      return true;
    }
  }
  return false;
}

function HydrationOpcodeCompiler() {
  this.opcodes = [];
  this.paths = [];
  this.templateId = 0;
  this.currentDOMChildIndex = 0;
  this.morphs = [];
  this.morphNum = 0;
  this.element = null;
  this.elementNum = -1;
}

HydrationOpcodeCompiler.prototype.compile = function(ast) {
  var templateVisitor = new TemplateVisitor();
  templateVisitor.visit(ast);

  processOpcodes(this, templateVisitor.actions);

  return this.opcodes;
};

HydrationOpcodeCompiler.prototype.startProgram = function(program, c, blankChildTextNodes) {
  this.opcodes.length = 0;
  this.paths.length = 0;
  this.morphs.length = 0;
  this.templateId = 0;
  this.currentDOMChildIndex = -1;
  this.morphNum = 0;

  var blockParams = program.blockParams || [];

  for (var i = 0; i < blockParams.length; i++) {
    this.opcode('blockParam', blockParams[i], i);
  }

  if (blankChildTextNodes.length > 0){
    this.opcode( 'repairClonedNode',
                 blankChildTextNodes );
  }
};

HydrationOpcodeCompiler.prototype.endProgram = function(/* program */) {
  distributeMorphs(this.morphs, this.opcodes);
};

HydrationOpcodeCompiler.prototype.text = function(/* string, pos, len */) {
  ++this.currentDOMChildIndex;
};

HydrationOpcodeCompiler.prototype.comment = function(/* string, pos, len */) {
  ++this.currentDOMChildIndex;
};

HydrationOpcodeCompiler.prototype.openElement = function(element, pos, len, isSingleRoot, mustacheCount, blankChildTextNodes) {
  distributeMorphs(this.morphs, this.opcodes);
  ++this.currentDOMChildIndex;

  this.element = this.currentDOMChildIndex;

  if (!isSingleRoot) {
    this.opcode('consumeParent', this.currentDOMChildIndex);

    // If our parent referance will be used more than once, cache its referance.
    if (mustacheCount > 1) {
      this.opcode('element', ++this.elementNum);
      this.element = null; // Set element to null so we don't cache it twice
    }
  }
  var isElementChecked = detectIsElementChecked(element);
  if (blankChildTextNodes.length > 0 || isElementChecked) {
    this.opcode( 'repairClonedNode',
                 blankChildTextNodes,
                 isElementChecked );
  }

  this.paths.push(this.currentDOMChildIndex);
  this.currentDOMChildIndex = -1;

  forEach(element.attributes, this.attribute, this);
  forEach(element.helpers, this.nodeHelper, this);
};

HydrationOpcodeCompiler.prototype.closeElement = function(element, pos, len, isSingleRoot) {
  distributeMorphs(this.morphs, this.opcodes);
  if (!isSingleRoot) { this.opcode('popParent'); }
  this.currentDOMChildIndex = this.paths.pop();
};

HydrationOpcodeCompiler.prototype.block = function(block, childIndex, childrenLength) {
  var sexpr = block.sexpr;
  var program = block.program || {};
  var blockParams = program.blockParams || [];

  var currentDOMChildIndex = this.currentDOMChildIndex;
  var start = (currentDOMChildIndex < 0) ? null : currentDOMChildIndex;
  var end = (childIndex === childrenLength - 1) ? null : currentDOMChildIndex + 1;

  var morphNum = this.morphNum++;
  this.morphs.push([morphNum, this.paths.slice(), start, end, true]);

  this.opcode('program', this.templateId++, block.inverse === null ? null : this.templateId++);
  processSexpr(this, sexpr);
  this.opcode('helper', sexpr.params.length, morphNum, blockParams.length);
};

HydrationOpcodeCompiler.prototype.component = function(component, childIndex, childrenLength) {
  var currentDOMChildIndex = this.currentDOMChildIndex;
  var program = component.program || {};
  var blockParams = program.blockParams || [];

  var start = (currentDOMChildIndex < 0 ? null : currentDOMChildIndex),
      end = (childIndex === childrenLength - 1 ? null : currentDOMChildIndex + 1);

  var morphNum = this.morphNum++;
  this.morphs.push([morphNum, this.paths.slice(), start, end]);

  var id = {
    string: component.tag,
    parts: component.tag.split('.')
  };

  this.opcode('program', this.templateId++, null);
  processName(this, id);
  processHash(this, buildHashFromAttributes(component.attributes));
  this.opcode('component', morphNum, blockParams.length);
};

HydrationOpcodeCompiler.prototype.opcode = function(type) {
  var params = [].slice.call(arguments, 1);
  this.opcodes.push([type, params]);
};

HydrationOpcodeCompiler.prototype.attribute = function(attr) {
  var parts = attr.value;
  if (parts.length === 1 && parts[0].type === 'TextNode') {
    return;
  }

  var params = attr.value;

  this.opcode('program', null, null);
  processSexpr(this, { params: params });

  if (this.element !== null) {
    this.opcode('element', ++this.elementNum);
    this.element = null;
  }
  this.opcode('attribute', attr.quoted, attr.name, params.length, this.elementNum);
};

HydrationOpcodeCompiler.prototype.nodeHelper = function(sexpr) {
  this.opcode('program', null, null);
  processSexpr(this, sexpr);
  // If we have a helper in a node, and this element has not been cached, cache it
  if(this.element !== null){
    this.opcode('element', ++this.elementNum);
    this.element = null; // Reset element so we don't cache it more than once
  }
  this.opcode('nodeHelper', sexpr.params.length, this.elementNum);
};

HydrationOpcodeCompiler.prototype.mustache = function(mustache, childIndex, childrenLength) {
  var sexpr = mustache.sexpr;
  var currentDOMChildIndex = this.currentDOMChildIndex;

  var start = currentDOMChildIndex,
      end = (childIndex === childrenLength - 1 ? -1 : currentDOMChildIndex + 1);

  var morphNum = this.morphNum++;
  this.morphs.push([morphNum, this.paths.slice(), start, end, mustache.escaped]);

  if (isHelper(sexpr)) {
    this.opcode('program', null, null);
    processSexpr(this, sexpr);
    this.opcode('helper', sexpr.params.length, morphNum);
  } else {
    processName(this, sexpr.path);
    this.opcode('ambiguous', morphNum);
  }
};

HydrationOpcodeCompiler.prototype.SubExpression = function(sexpr) {
  this.string('sexpr');
  this.opcode('program', null, null);
  processSexpr(this, sexpr);
  this.opcode('sexpr', sexpr.params.length);
};

HydrationOpcodeCompiler.prototype.PathExpression = function(path) {
  this.opcode('id', path.parts);
};

HydrationOpcodeCompiler.prototype.StringLiteral = function(node) {
  this.opcode('stringLiteral', node.value);
};

HydrationOpcodeCompiler.prototype.BooleanLiteral = function(node) {
  this.opcode('literal', node.value);
};

HydrationOpcodeCompiler.prototype.NumberLiteral = function(node) {
  this.opcode('literal', node.value);
};

HydrationOpcodeCompiler.prototype.string = function(str) {
  this.opcode('string', str);
};

function processSexpr(compiler, sexpr) {
  processName(compiler, sexpr.path);
  processParams(compiler, sexpr.params);
  processHash(compiler, sexpr.hash);
}

function processName(compiler, path) {
  if (path) {
    compiler.opcode('string', path.parts.join('.'));
  } else {
    compiler.opcode('string', '');
  }
}

function processParams(compiler, params) {
  forEach(params, function(param) {
    if (param.type === 'TextNode') {
      compiler.StringLiteral(buildString(param.chars));
    } else if (param.type) {
      compiler[param.type](param);
    } else {
      compiler.StringLiteral(buildString(param));
    }
  });
}

function processHash(compiler, hash) {
  if (hash) {
    forEach(hash.pairs, function(pair) {
      var key = pair.key;
      var value = pair.value;
      compiler[value.type](value);
      compiler.opcode('stackLiteral', key);
    });
    compiler.opcode('stackLiteral', hash.pairs.length);
  } else {
    compiler.opcode('stackLiteral', 0);
  }
}

function distributeMorphs(morphs, opcodes) {
  if (morphs.length === 0) {
    return;
  }

  // Splice morphs after the most recent shareParent/consumeParent.
  var o;
  for (o = opcodes.length - 1; o >= 0; --o) {
    var opcode = opcodes[o][0];
    if (opcode === 'element' || opcode === 'consumeParent'  || opcode === 'popParent') {
      break;
    }
  }

  var spliceArgs = [o + 1, 0];
  for (var i = 0; i < morphs.length; ++i) {
    spliceArgs.push(['morph', morphs[i].slice()]);
  }
  opcodes.splice.apply(opcodes, spliceArgs);
  morphs.length = 0;
}

exports.HydrationOpcodeCompiler = HydrationOpcodeCompiler;