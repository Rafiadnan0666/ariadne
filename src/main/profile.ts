import { app } from 'electron'

/**
 * Allow an isolated profile for tests, demos and portable installs.
 * Must run before any module that reads app.getPath('userData').
 */
if (process.env.ARIADNE_USER_DATA) {
  app.setPath('userData', process.env.ARIADNE_USER_DATA)
}
