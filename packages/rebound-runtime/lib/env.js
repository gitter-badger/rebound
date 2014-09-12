import { merge } from "htmlbars-runtime/utils";
import DOMHelper from "morph/dom-helper";
import hooks from "rebound-runtime/hooks";
import helpers from "rebound-runtime/helpers";

var env = {
  registerPartial: helpers.registerPartial,
  registerHelper: helpers.registerHelper,
  helpers: helpers.helpers,
  hooks: hooks
};

env.hydrate = function(spec, options){
  // Return a wrapper function that will merge user provided helpers with our defaults
  return function(data, options){
    // Ensure we have a well-formed object as var options
    var env = options || {};
    env.helpers = env.helpers || {};
    env.hooks = env.hooks || {};
    env.dom = env.dom || new DOMHelper();

    // Merge our default helpers and hooks with user provided helpers
    env.helpers = merge(env.helpers, helpers.helpers);
    env.hooks = merge(env.hooks, hooks);

    // Call our func with merged helpers and hooks
    return spec.call(this, data, env);
  };
};

// Notify all of a object's observers of the change, execute the callback
env.notify = function(obj, path) {

  // If path is not an array of keys, wrap it in array
  path = (_.isString(path)) ? [path] : path;

  // For each path, alert each observer and call its callback
  _.each(path, function(path){
    if(_.isArray(obj.__observers[path])){
      _.each(obj.__observers[path], function(callback, index) {
        if(callback){ callback(); }
        else{ delete obj.__observers[path][index]; }
      });
    }
  });
};

export default env;