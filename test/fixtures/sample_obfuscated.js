var Gg = ["document", "Hello", "log", "World"];

(function (arr, num) {
  while (--num) {
    arr.push(arr.shift());
  }
})(Gg, 4);

function Xj(a, b) {
  a = a - 0;
  var c = Gg[a];
  return c;
}

var a = Xj;
var b = a;

!function () {
  var c = b("1");
  window[c];
}();
