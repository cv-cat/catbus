var _yt_player={};(function(g){
var window = this;
var stsConfig = { signatureTimestamp: 20760 };
var W = function (u) {
  this.inner = new URL(u);
}
W.prototype.set = function (k, v) { this.inner.searchParams.set(k, v); return this; };
W.prototype.get = function (k) { return this.inner.searchParams.get(k); };
W.prototype.clone = function () { return new W(this.inner.href); };
W.prototype.transform = function () {
  var s = this.get("s");
  if (s != null) {
    var a = s.split("");
    a.reverse();
    a.push(a.shift()); a.push(a.shift()); a.push(a.shift());
    this.set("s", a.join(""));
  }
  var n = this.get("n");
  if (n != null && n.length > 8) {
    this.set("n", n.split("").reverse().join(""));
  }
  this.set("alr", "yes");
};
var U = function (u, k, s) {
  var p = new W(u);
  if (s != null) { p.set(k, s); }
  p.set("alr", "yes");
  return p;
};
g.h = U;
})(_yt_player);
