'use strict';

const { getDialect } = require('./dialects');
const createSchemaProvider = require('./schema');
const createMetadata = require('./metadata');
const { createEntityManager } = require('./entity-manager');
const { createMigrationsProvider } = require('./migrations');
const { createLifecyclesProvider } = require('./lifecycles');
const createConnection = require('./connection');
const errors = require('./errors');
const transactionCtx = require('./transaction-context');

// TODO: move back into strapi
const { transformContentTypes } = require('./utils/content-types');

class Database {
  constructor(config) {
    this.metadata = createMetadata(config.models);

    this.config = {
      connection: {},
      settings: {
        forceMigration: true,
      },
      ...config,
    };

    this.dialect = getDialect(this);
    this.dialect.configure();

    this.connection = createConnection(this.config.connection);

    this.dialect.initialize();

    this.schema = createSchemaProvider(this);

    this.migrations = createMigrationsProvider(this);
    this.lifecycles = createLifecyclesProvider(this);

    this.entityManager = createEntityManager(this);
  }

  query(uid) {
    if (!this.metadata.has(uid)) {
      throw new Error(`Model ${uid} not found`);
    }

    return this.entityManager.getRepository(uid);
  }

  async transaction(cb, { onError, onSuccess } = {}) {
    const notNestedTransaction = !transactionCtx.get();
    const trx = notNestedTransaction ? await this.connection.transaction() : transactionCtx.get();
    if (!cb) {
      return {
        async commit() {
          if (notNestedTransaction) {
            await trx.commit();
          }
        },
        async rollback() {
          if (notNestedTransaction) {
            await trx.rollback();
          }
        },
        get() {
          return trx;
        },
      };
    }

    return transactionCtx.run(trx, async () => {
      try {
        const res = await cb(trx);
        if (notNestedTransaction) {
          await trx.commit();
        }
        await onSuccess?.();
        return res;
      } catch (error) {
        if (notNestedTransaction) {
          await trx.rollback();
        }
        await onError?.();
        throw error;
      }
    });
  }

  getConnection(tableName) {
    const schema = this.connection.getSchemaName();
    const connection = tableName ? this.connection(tableName) : this.connection;
    return schema ? connection.withSchema(schema) : connection;
  }

  getSchemaConnection(trx = this.connection) {
    const schema = this.connection.getSchemaName();
    return schema ? trx.schema.withSchema(schema) : trx.schema;
  }

  queryBuilder(uid) {
    return this.entityManager.createQueryBuilder(uid);
  }

  async destroy() {
    await this.lifecycles.clear();
    await this.connection.destroy();
  }
}

// TODO: move into strapi
Database.transformContentTypes = transformContentTypes;
Database.init = async (config) => new Database(config);

module.exports = {
  Database,
  errors,
};
