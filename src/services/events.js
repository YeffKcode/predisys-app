'use strict';
const { EventEmitter } = require('events');

// Bus en memoria para empujar alertas y notificaciones a la UI vía SSE
const alertBus = new EventEmitter();
alertBus.setMaxListeners(200);

module.exports = { alertBus };
