(function(){function r(e,n,t){function o(i,f){if(!n[i]){if(!e[i]){var c="function"==typeof require&&require;if(!f&&c)return c(i,!0);if(u)return u(i,!0);var a=new Error("Cannot find module '"+i+"'");throw a.code="MODULE_NOT_FOUND",a}var p=n[i]={exports:{}};e[i][0].call(p.exports,function(r){var n=e[i][1][r];return o(n||r)},p,p.exports,r,e,n,t)}return n[i].exports}for(var u="function"==typeof require&&require,i=0;i<t.length;i++)o(t[i]);return o}return r})()({1:[function(require,module,exports){
var Node = require('./lib/node');
var PQueue = require('./lib/pqueue');

/**
 * A Trie optimized for weighted autocompletion returning a small number
 * of results.
 *
 * It can take an optional ({maxWidth: X}) parameter. This parameter is
 * set relatively large because we care a lot about indexing time, and
 * lookup is so fast that slowing it down by a factor of 10 is still
 * fast enough for more most use-cases.
 *
 * NOTE: The factor only affects the first lookup for any given prefix,
 * after a trie mutation. After that the widthFactor is mostly irrelevant.
 */
var Trie = function (options) {
    this.root = new Node();
    if (options && options.maxWidth) {
      this.maxWidth = options.maxWidth;
    } else {
      this.maxWidth = 500;
    }
};

/**
 * Add a new item to the auto-completer.
 *
 * It should have:
 * a .key property that is a non-empty string.
 * a .score property that is a positive number.
 * a .value property that is opaque (and returned by the prefixSearch method)
 * a .distinct property that is used to distinguish between multiple values that have the same key.
 */
Trie.prototype.add = function (item) {
    this.root.add(item, 0, this.maxWidth);
};

/**
 * Prefix search terms in the auto-completer.
 *
 * Returns an array of values that have keys starting with the prefix.
 *
 * You are encouraged to pass an options object with:
 * a .limit to limit the number of results returned.
 * a .unique property if you only want one result per-key.
 *
 * The limit is particularly important because the performance of the
 * algorithm is determined primarily by the limit.
 */
Trie.prototype.prefixSearch = function (prefix, opts) {
    var results = [];
    var node = this.root.findPrefix(prefix, 0);

    if (!opts) {
        opts = {};
    }

    if (opts.limit == null) {
        opts.limit = 1 / 0;
    }

    if (!node) {
      return results;
    }

    node.getSortedResults(prefix, results, opts, new PQueue(opts.limit));

    return results;
};

module.exports = Trie;

},{"./lib/node":2,"./lib/pqueue":3}],2:[function(require,module,exports){
/**
 * A Node in the autocompleter Trie.
 */
var Node = function () {
    /* The maximum score of all the values in this element
     * or its children */
    this.score = 0;

    /* The children of the trie indexed by letter.
     * {a: new Node(), b: new Node(), ...}
     */
    this.children = {};

    /* Both the children and values of the tree,
     * sorted by score.
     * We use one list for convenient sorting, but
     * it's kind of unhygenic.
     */
    this.values = [];
    /* Indicates whether the list of values is sorted.
     * Because building the tree takes a significant amount of
     * time, and we probably won't use most of it, the tree is
     * left unsorted until query time.
     *
     * This is an amortised cost, paid back in small doses over
     * the first few queries to the tree.
     */
    this.sorted = true;

    this.leaf = true;
}

/* Add a new item to the node.
 *
 * The item has a .key, .score and .value, and the index indicates the position in
 * the key (i.e. the depth in the trie) that this node is responsible for.
 */
Node.prototype.add = function (item, index, maxWidth) {

    if (item.score > this.score) {
        this.score = item.score;
    }

    if (this.leaf && index < item.key.length && this.values.length > maxWidth) {
        var oldValues = this.values;
        this.values = [];
        this.leaf = false;
        for (var i = 0; i < oldValues.length; i++) {
          var item = oldValues[i],
            chr = item.key[index];

          if (!this.children[chr]) {
              this.children[chr] = new Node();
              this.values.push(chr);
          }

          this.children[chr].add(item, index + 1, maxWidth);
        }
    }

    if (this.leaf) {
        this.values.push(item)
    } else {
        var chr = item.key[index];

        if (!this.children[chr]) {
            this.children[chr] = new Node();
            this.values.push(chr);
        }

        this.children[chr].add(item, index + 1, maxWidth);
    }

    this.sorted = false;
}

Node.prototype.sort = function () {
  if (this.sorted) { return }
  this.sorted = true;

  if (this.leaf) {
    this.values.sort(function (a, b) {
      return b.score - a.score;
    })

  } else {
    this.values.sort(function (a, b) {
      return this.children[b].score -  this.children[a].score;
    }.bind(this))
  }

}

// Find the node responsible for the given prefix.
// Index indicates how far we've looked already.
// Returns null if no such node could be found.
Node.prototype.findPrefix = function (key, index) {

    if (this.leaf || index == key.length) {
        return this;
    }

    var chr = key[index];
    if (this.children[chr]) {
        return this.children[chr].findPrefix(key, index + 1);
    }

    return null;
}

/**
 * Recurse over all child nodes to get the top N results by score.
 *
 * We do this using a best-first-search with the score we've cached
 * on each node.
 *
 * We use the passed in pqueue which has a limit and unique flag to
 * configure the search.
 */
Node.prototype.getSortedResults = function (prefix, results, opts, pqueue) {

    var seenKeys = {};

    if (this.leaf) {
      if (!this.sorted) {
        this.sort()
      }

      for (var i = 0; i < this.values.length; i++) {
        var item = this.values[i];
        if (item.key.startsWith(prefix)) {
            if (!opts.unique || !seenKeys[item.key + "\uffef" + (item.distinct ? item.distinct : "")]) {
                seenKeys[item.key + "\uffef" + (item.distinct ? item.distinct : "")] = true;
                results.push(item.value);

                if (results.length == opts.limit) {
                  return;
                }
            }
        }
      }
    } else {

      pqueue.addList([this]);

      while (next = pqueue.pop()) {
          if (next instanceof Node) {
              if (!next.sorted) {
                  next.sort()
              }

              if (next.leaf) {
                pqueue.addList(next.values);
              } else {
                pqueue.addList(next.values.map((v) => {
                  return next.children[v]
                }))
              }
          } else {
              if (!opts.unique || !seenKeys[next.key + "\uffef" + (next.distinct ? next.distinct : "")]) {
                  seenKeys[next.key + "\uffef" + (next.distinct ? next.distinct : "")] = true;
                  results.push(next.value);
              }

              if (results.length === opts.limit) {
                  return;
              }
          }
      }
    }
}

module.exports = Node;

},{}],3:[function(require,module,exports){
var Node = require('./node');
/* A PQueue with a limited size.
 *
 * The unique flag is an implementation detail, when
 * set to true it will only pick the highest scoring item
 * from each node. Which provides unique key behaviour for
 * prefixSearching.
 */
var PQueue = function (limit, unique) {
    this.todo = [];
    this.limit = limit;
};

PQueue.prototype.addList = function (list) {

    var i = 0, j = 0;

    // effectiveLength is the lower bound on the number of
    // item's we're guaranteed to be able to find in the trie.
    // In the case that unique is false this is the same as the length,
    // but in the case unique is true, it's the number of Nodes in the queue
    // (as items may be discarded).
    var effectiveLength = 0;

    while (i < this.todo.length && effectiveLength < this.limit) {

        if (j < list.length && this.todo[i].score < list[j].score) {
            this.todo.splice(i, 0, list[j]);
            j += 1;
        }

        if (this.todo[i] instanceof Node) {
            effectiveLength += 1;
        }

        i += 1;
    }

    while (this.todo.length > i) {
        this.todo.pop();
    }

    while (effectiveLength < this.limit && j < list.length) {
        this.todo.push(list[j]);
        if (list[j] instanceof Node) {
            effectiveLength += 1;
        }
        j += 1;
    }
};

PQueue.prototype.pop = function () {
    return this.todo.shift();
};

module.exports = PQueue;

},{"./node":2}]},{},[1]);
