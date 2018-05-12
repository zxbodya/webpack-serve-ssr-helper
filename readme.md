# webpack-serve ssr helper

Helper utility to sync webpack-serve and nodemon for apps with server side rendering

It a wrapper around webpack compiler, webpack-serve it adds proxy into webpack-serve for application managed by nodemon,
and ensures that all reloads from browser are loading data from up to date server-side bundle.

Proxy it will wait before request processing if new åbuild is in progress or when server is not ready yet.       

In result it removes some frustration, especially when changing code shared between server and client side parts.

See usage example in examples folder or in [router1-app-template](https://github.com/zxbodya/router1-app-template)
