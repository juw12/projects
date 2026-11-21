// Sharp canvases on 2x and 3x screens, for games written for a fixed canvas size.
//
// A game here draws into, say, <canvas width="900" height="480"> and the browser stretches those
// pixels over a phone or laptop screen that has two or three times as many: soft text, soft edges.
// Loaded before the game's own script, this file gives each on-screen 2D canvas a backing store of
// up to 2x its size and scales the drawing to match. The game still sees a 900 x 480 canvas
// (canvas.width, mouse maths, clearRect), so it does not have to know.
//
// Left alone: canvases that are not in the page when their context is made (off-screen buffers),
// WebGL canvases, and any canvas with data-hidpi="off".
(function () {
  'use strict';
  var ratio = Math.min(window.devicePixelRatio || 1, 2);
  if (!(ratio > 1) || !window.HTMLCanvasElement || !window.CanvasRenderingContext2D) {
    return;
  }
  var canvasProto = HTMLCanvasElement.prototype;
  var contextProto = CanvasRenderingContext2D.prototype;
  var widthProp = Object.getOwnPropertyDescriptor(canvasProto, 'width');
  var heightProp = Object.getOwnPropertyDescriptor(canvasProto, 'height');
  var realGetContext = canvasProto.getContext;
  var realSetTransform = contextProto.setTransform;
  var realGetTransform = contextProto.getTransform;
  var realDrawImage = contextProto.drawImage;
  var realReset = contextProto.reset;
  var MAX_SIDE = 2400;

  // The size the game asked for, for a canvas this file has enlarged.
  function logical(canvas) {
    return canvas && canvas.__hidpi ? canvas.__hidpi : null;
  }

  function scaledProperty(context, name) {
    var prop = Object.getOwnPropertyDescriptor(contextProto, name);
    if (!prop || !prop.get || !prop.set) {
      return;
    }
    // Shadows are measured in backing pixels, not in the scaled drawing units.
    Object.defineProperty(context, name, {
      configurable: true,
      get: function () { return prop.get.call(context) / ratio; },
      set: function (value) { prop.set.call(context, value * ratio); },
    });
  }

  function pointTest(context, name) {
    var real = contextProto[name];
    // isPointInPath takes backing pixels too.
    context[name] = function () {
      var args = Array.prototype.slice.call(arguments);
      var first = typeof args[0] === 'number' ? 0 : 1;
      args[first] *= ratio;
      args[first + 1] *= ratio;
      return real.apply(context, args);
    };
  }

  function enlarge(canvas, context) {
    var size = { width: widthProp.get.call(canvas), height: heightProp.get.call(canvas), styled: false };
    if (!size.width || !size.height || Math.max(size.width, size.height) * ratio > MAX_SIDE * 2) {
      return;
    }
    // What the page's CSS says about this canvas's size ("auto" = nothing): asked while it is
    // out of the layout, because only then does the browser answer with the rule, not the result.
    var shown = canvas.getBoundingClientRect();
    var display = canvas.style.display;
    canvas.style.display = 'none';
    var rule = getComputedStyle(canvas);
    var unsized = rule.width === 'auto' && rule.height === 'auto';
    canvas.style.display = display;

    function base() {
      realSetTransform.call(context, ratio, 0, 0, ratio, 0, 0);
    }
    function apply() {
      widthProp.set.call(canvas, Math.round(size.width * ratio));
      heightProp.set.call(canvas, Math.round(size.height * ratio));
      if (size.styled) {
        canvas.style.width = size.width + 'px';
      }
      base();
    }

    canvas.__hidpi = size;
    Object.defineProperty(canvas, 'width', {
      configurable: true,
      get: function () { return size.width; },
      set: function (value) { size.width = Math.max(0, Math.floor(Number(value) || 0)); apply(); },
    });
    Object.defineProperty(canvas, 'height', {
      configurable: true,
      get: function () { return size.height; },
      set: function (value) { size.height = Math.max(0, Math.floor(Number(value) || 0)); apply(); },
    });
    apply();

    // A canvas with no CSS size takes its size on the page from its pixel size, which just doubled.
    // Give it back the width it had; its height follows from the unchanged proportions.
    if (unsized) {
      size.styled = true;
      canvas.style.width = size.width + 'px';
    }
    var after = canvas.getBoundingClientRect();
    if ((shown.width || shown.height) && (Math.abs(after.width - shown.width) > 0.5 || Math.abs(after.height - shown.height) > 0.5)) {
      size.styled = false;
      canvas.style.width = shown.width + 'px';
      canvas.style.height = shown.height + 'px';
    }

    context.setTransform = function (a, b, c, d, e, f) {
      if (a && typeof a === 'object') {
        var m = a;
        a = m.a; b = m.b; c = m.c; d = m.d; e = m.e; f = m.f;
      }
      if (a === undefined) {
        base();
        return;
      }
      realSetTransform.call(context, a * ratio, b * ratio, c * ratio, d * ratio, e * ratio, f * ratio);
    };
    context.resetTransform = base;
    context.getTransform = function () {
      var m = realGetTransform.call(context);
      return new DOMMatrix([m.a / ratio, m.b / ratio, m.c / ratio, m.d / ratio, m.e / ratio, m.f / ratio]);
    };
    if (realReset) {
      context.reset = function () {
        realReset.call(context);
        base();
      };
    }
    scaledProperty(context, 'shadowBlur');
    scaledProperty(context, 'shadowOffsetX');
    scaledProperty(context, 'shadowOffsetY');
    pointTest(context, 'isPointInPath');
    pointTest(context, 'isPointInStroke');
  }

  canvasProto.getContext = function (type) {
    var context = realGetContext.apply(this, arguments);
    if (type === '2d' && context && !this.__hidpi && this.isConnected && this.getAttribute('data-hidpi') !== 'off') {
      try {
        enlarge(this, context);
      } catch (error) {
        // A canvas this file cannot enlarge keeps working at its own size.
      }
    }
    return context;
  };

  // Drawing an enlarged canvas somewhere (a snapshot, a trail effect): its natural size is the
  // backing size, so say the size the game means.
  contextProto.drawImage = function (image) {
    var size = logical(image);
    if (!size) {
      return realDrawImage.apply(this, arguments);
    }
    var a = arguments;
    if (a.length === 3) {
      return realDrawImage.call(this, image, a[1], a[2], size.width, size.height);
    }
    if (a.length === 9) {
      return realDrawImage.call(this, image, a[1] * ratio, a[2] * ratio, a[3] * ratio, a[4] * ratio, a[5], a[6], a[7], a[8]);
    }
    return realDrawImage.apply(this, a);
  };
})();
