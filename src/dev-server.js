/* eslint-disable no-console */
const webpack = require('webpack');
const serve = require('webpack-serve');
const convert = require('koa-connect');
const proxy = require('http-proxy-middleware');
const nodemon = require('nodemon');
const url = require('url');

const { combineLatest, Subject, BehaviorSubject, Observable } = require('rxjs');

const {
  first,
  filter,
  switchMap,
  mergeMap,
  tap,
  map,
  distinctUntilChanged,
} = require('rxjs/operators');

const { waitForPort } = require('./waitForPort');

function observeStatus(compiler, name) {
  return Observable.create(status => {
    compiler.hooks.compile.tap(name, () => {
      status.next({ status: 'compile' });
    });
    compiler.hooks.invalid.tap(name, () => {
      status.next({ status: 'invalid' });
    });
    compiler.hooks.done.tap(name, stats => {
      status.next({ status: 'done', stats });
    });
  });
}

module.exports = function startDevServer({
  frontendConfig,
  backendConfig,
  backendWatchOptions,
  nodemonConfig,
  appUrl,
  serveOptions,
}) {
  console.log('Starting development server…');

  const frontEndCompiler = webpack(frontendConfig);

  const frontStatus$ = observeStatus(frontEndCompiler, 'dev-server-sync');
  const backendCompiler = webpack(backendConfig);

  backendCompiler.watch(backendWatchOptions, (err, stats) => {
    if (err) {
      console.log('Backend webpack error', err);
    } else {
      console.log(
        stats.toString(
          Object.assign({ colors: true }, backendConfig.devServer.stats)
        )
      );
    }
  });

  const backendStatus$ = observeStatus(backendCompiler, 'dev-server-sync');

  const nodemonStart$ = new Subject();

  function startServer() {
    nodemon(nodemonConfig).on('start', () => {
      nodemonStart$.next('start');
    });
  }

  const appUrlParsed = url.parse(appUrl);
  const appPort =
    appUrlParsed.port ||
    (appUrlParsed.protocol === 'http:' && 80) ||
    (appUrlParsed.protocol === 'https:' && 433);
  const appHost = appUrlParsed.hostname;

  if (!appHost || !appPort) {
    throw new Error('Can not detect hostname  and port from appUrl');
  }

  combineLatest(
    frontStatus$.pipe(
      filter(({ status }) => status === 'done'),
      first()
    ),
    backendStatus$.pipe(
      filter(({ status }) => status === 'done'),
      first()
    ),
    startServer
  ).subscribe(() => {
    console.log('Starting server');
    nodemonStart$
      .pipe(
        first(),
        mergeMap(() => waitForPort(appPort, appHost))
      )
      .subscribe(() => {
        console.log('Server is ready');
      });
  });

  const isReady$ = new BehaviorSubject(false);

  backendStatus$
    .pipe(
      switchMap(({ status }) => {
        if (status === 'done') {
          nodemon.restart();
          console.log('Restarting server');
          return nodemonStart$.pipe(
            first(),
            mergeMap(() => waitForPort(appPort, appHost)),
            tap(() => {
              console.log('Server is ready');
            }),
            map(() => true)
          );
        }
        return [false];
      }),
      distinctUntilChanged()
    )
    .subscribe(isReady$);

  serve(
    {},
    {
      ...serveOptions,
      compiler: frontEndCompiler,
      add: (app, middleware) => {
        const p = convert(proxy('/', { target: appUrl }));
        // since we're manipulating the order of middleware added, we need to handle
        // adding these two internal middleware functions.
        middleware.content();
        middleware.webpack();

        app.use(async (ctx, next) => {
          await isReady$
            .pipe(
              filter(v => v),
              first()
            )
            .toPromise();
          return p(ctx, next);
        });
      },
    }
  );

  // workaround for nodemon
  process.once('SIGINT', () => {
    process.exit(0);
  });
};
