const x = 1;
const y = 2;
const add = require("./test2.js");
console.log(add(x, y));

const qs = require("querystring");
qs.encode({
  name: "cj",
  age: 23
});

const fs = require("fs");

const async_wrap = process.binding("async_wrap");
console.log("async_wrap: ", async_wrap);
