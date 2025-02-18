/*
 * Copyright 2021 The Backstage Authors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
import { TestDatabaseId, TestDatabases } from '@backstage/backend-test-utils';
import { IndexableDocument } from '@backstage/search-common';
import { DatabaseDocumentStore } from './DatabaseDocumentStore';

describe('DatabaseDocumentStore', () => {
  describe('unsupported', () => {
    const databases = TestDatabases.create({
      ids: ['MYSQL_8', 'POSTGRES_9', 'SQLITE_3'],
    });

    it.each(databases.eachSupportedId())(
      'should return support state, %p',
      async databaseId => {
        const knex = await databases.init(databaseId);
        const supported = await DatabaseDocumentStore.supported(knex);

        expect(supported).toBe(false);
      },
      60_000,
    );

    it.each(databases.eachSupportedId())(
      'should fail to create, %p',
      async databaseId => {
        const knex = await databases.init(databaseId);

        await expect(
          async () => await DatabaseDocumentStore.create(knex),
        ).rejects.toThrow();
      },
      60_000,
    );
  });

  describe('supported', () => {
    const databases = TestDatabases.create({
      ids: ['POSTGRES_13'],
    });

    async function createStore(databaseId: TestDatabaseId) {
      const knex = await databases.init(databaseId);
      const store = await DatabaseDocumentStore.create(knex);
      return { store, knex };
    }

    if (databases.eachSupportedId().length < 1) {
      // Only execute tests if at least on database engine is available, e.g. if
      // not in CI=1. it.each doesn't support an empty array.
      return;
    }

    it.each(databases.eachSupportedId())(
      'should return support state, %p',
      async databaseId => {
        const knex = await databases.init(databaseId);
        const supported = await DatabaseDocumentStore.supported(knex);

        expect(supported).toBe(true);
      },
      60_000,
    );

    it.each(databases.eachSupportedId())(
      'should insert documents, %p',
      async databaseId => {
        const { store, knex } = await createStore(databaseId);

        await store.transaction(async tx => {
          await store.prepareInsert(tx);
          await store.insertDocuments(tx, 'my-type', [
            {
              title: 'TITLE 1',
              text: 'TEXT 1',
              location: 'LOCATION-1',
            },
            {
              title: 'TITLE 2',
              text: 'TEXT 2',
              location: 'LOCATION-2',
            },
          ]);
          await store.completeInsert(tx, 'my-type');
        });

        expect(
          await knex.count('*').where('type', 'my-type').from('documents'),
        ).toEqual([{ count: '2' }]);
      },
      60_000,
    );

    it.each(databases.eachSupportedId())(
      'should insert documents in batches, %p',
      async databaseId => {
        const { store, knex } = await createStore(databaseId);

        await store.transaction(async tx => {
          await store.prepareInsert(tx);
          await store.insertDocuments(tx, 'my-type', [
            {
              title: 'TITLE 1',
              text: 'TEXT 1',
              location: 'LOCATION-1',
            },
            {
              title: 'TITLE 2',
              text: 'TEXT 2',
              location: 'LOCATION-2',
            },
          ]);
          await store.insertDocuments(tx, 'my-type', [
            {
              title: 'TITLE 3',
              text: 'TEXT 3',
              location: 'LOCATION-3',
            },
            {
              title: 'TITLE 4',
              text: 'TEXT 4',
              location: 'LOCATION-4',
            },
          ]);
          await store.completeInsert(tx, 'my-type');
        });

        expect(
          await knex.count('*').where('type', 'my-type').from('documents'),
        ).toEqual([{ count: '4' }]);
      },
      60_000,
    );

    it.each(databases.eachSupportedId())(
      'should clear index for type, %p',
      async databaseId => {
        const { store, knex } = await createStore(databaseId);

        await store.transaction(async tx => {
          await store.prepareInsert(tx);
          await store.insertDocuments(tx, 'test', [
            {
              title: 'TITLE 1',
              text: 'TEXT 1',
              location: 'LOCATION-1',
            },
          ]);
          await store.completeInsert(tx, 'test');
        });
        await store.transaction(async tx => {
          await store.prepareInsert(tx);
          await store.insertDocuments(tx, 'my-type', [
            {
              title: 'TITLE 1',
              text: 'TEXT 1',
              location: 'LOCATION-1',
            },
            {
              title: 'TITLE 2',
              text: 'TEXT 2',
              location: 'LOCATION-2',
            },
          ]);
          await store.completeInsert(tx, 'my-type');
        });
        await store.transaction(async tx => {
          await store.prepareInsert(tx);
          await store.completeInsert(tx, 'my-type');
        });

        expect(
          await knex.count('*').where('type', 'test').from('documents'),
        ).toEqual([{ count: '1' }]);
        expect(
          await knex.count('*').where('type', 'my-type').from('documents'),
        ).toEqual([{ count: '0' }]);
      },
      60_000,
    );

    it.each(databases.eachSupportedId())(
      'query by term, %p',
      async databaseId => {
        const { store } = await createStore(databaseId);

        await store.transaction(async tx => {
          await store.prepareInsert(tx);
          await store.insertDocuments(tx, 'test', [
            {
              title: 'Lorem Ipsum',
              text: 'Hello World',
              location: 'LOCATION-1',
            },
            {
              title: 'Hello World',
              text: 'Around the world',
              location: 'LOCATION-1',
            },
          ]);
          await store.completeInsert(tx, 'test');
        });

        const rows = await store.transaction(tx =>
          store.query(tx, { pgTerm: 'Hello & World' }),
        );

        expect(rows).toEqual([
          {
            document: {
              location: 'LOCATION-1',
              text: 'Around the world',
              title: 'Hello World',
            },
            rank: expect.any(Number),
            type: 'test',
          },
          {
            document: {
              location: 'LOCATION-1',
              text: 'Hello World',
              title: 'Lorem Ipsum',
            },
            rank: expect.any(Number),
            type: 'test',
          },
        ]);
      },
      60_000,
    );

    it.each(databases.eachSupportedId())(
      'query by term for specific type, %p',
      async databaseId => {
        const { store } = await createStore(databaseId);

        await store.transaction(async tx => {
          await store.prepareInsert(tx);
          await store.insertDocuments(tx, 'my-type', [
            {
              title: 'Lorem Ipsum',
              text: 'Hello World',
              location: 'LOCATION-1',
            },
          ]);
          await store.completeInsert(tx, 'my-type');
        });
        await store.transaction(async tx => {
          await store.prepareInsert(tx);
          await store.insertDocuments(tx, 'test', [
            {
              title: 'Hello World',
              text: 'Around the world',
              location: 'LOCATION-1',
            },
          ]);
          await store.completeInsert(tx, 'test');
        });

        const rows = await store.transaction(tx =>
          store.query(tx, { pgTerm: 'Hello & World', types: ['my-type'] }),
        );

        expect(rows).toEqual([
          {
            document: {
              location: 'LOCATION-1',
              text: 'Hello World',
              title: 'Lorem Ipsum',
            },
            rank: expect.any(Number),
            type: 'my-type',
          },
        ]);
      },
      60_000,
    );

    it.each(databases.eachSupportedId())(
      'query by term and filter by field, %p',
      async databaseId => {
        const { store } = await createStore(databaseId);

        await store.transaction(async tx => {
          await store.prepareInsert(tx);
          await store.insertDocuments(tx, 'my-type', [
            {
              title: 'Lorem Ipsum',
              text: 'Hello World',
              myField: 'this',
              location: 'LOCATION-1',
            } as unknown as IndexableDocument,
            {
              title: 'Dolor sit amet',
              text: 'Hello World',
              myField: 'that',
              location: 'LOCATION-1',
            } as unknown as IndexableDocument,
            {
              title: 'Hello World',
              text: 'Around the world',
              location: 'LOCATION-1',
            },
          ]);
          await store.completeInsert(tx, 'my-type');
        });

        const rows = await store.transaction(tx =>
          store.query(tx, {
            pgTerm: 'Hello & World',
            fields: { myField: 'this' },
          }),
        );

        expect(rows).toEqual([
          {
            document: {
              location: 'LOCATION-1',
              text: 'Hello World',
              title: 'Lorem Ipsum',
              myField: 'this',
            },
            rank: expect.any(Number),
            type: 'my-type',
          },
        ]);
      },
      60_000,
    );

    it.each(databases.eachSupportedId())(
      'query by term and filter by field (any of), %p',
      async databaseId => {
        const { store } = await createStore(databaseId);

        await store.transaction(async tx => {
          await store.prepareInsert(tx);
          await store.insertDocuments(tx, 'my-type', [
            {
              title: 'Lorem Ipsum',
              text: 'Hello World',
              myField: 'this',
              location: 'LOCATION-1',
            } as unknown as IndexableDocument,
            {
              title: 'Dolor sit amet',
              text: 'Hello World',
              myField: 'that',
              location: 'LOCATION-1',
            } as unknown as IndexableDocument,
            {
              title: 'Hello World',
              text: 'Around the world',
              location: 'LOCATION-1',
            },
          ]);
          await store.completeInsert(tx, 'my-type');
        });

        const rows = await store.transaction(tx =>
          store.query(tx, {
            pgTerm: 'Hello & World',
            fields: { myField: ['this', 'that'] },
          }),
        );

        expect(rows).toEqual([
          {
            document: {
              location: 'LOCATION-1',
              text: 'Hello World',
              title: 'Lorem Ipsum',
              myField: 'this',
            },
            rank: expect.any(Number),
            type: 'my-type',
          },
          {
            document: {
              location: 'LOCATION-1',
              text: 'Hello World',
              title: 'Dolor sit amet',
              myField: 'that',
            },
            rank: expect.any(Number),
            type: 'my-type',
          },
        ]);
      },
      60_000,
    );

    it.each(databases.eachSupportedId())(
      'query by term and filter by fields, %p',
      async databaseId => {
        const { store } = await createStore(databaseId);

        await store.transaction(async tx => {
          await store.prepareInsert(tx);
          await store.insertDocuments(tx, 'my-type', [
            {
              title: 'Lorem Ipsum',
              text: 'Hello World',
              myField: 'this',
              otherField: 'another',
              location: 'LOCATION-1',
            } as unknown as IndexableDocument,
            {
              title: 'Dolor sit amet',
              text: 'Hello World',
              myField: 'this',
              otherField: 'unknown',
              location: 'LOCATION-1',
            } as unknown as IndexableDocument,
          ]);
          await store.completeInsert(tx, 'my-type');
        });

        const rows = await store.transaction(tx =>
          store.query(tx, {
            pgTerm: 'Hello & World',
            fields: { myField: 'this', otherField: 'another' },
          }),
        );

        expect(rows).toEqual([
          {
            document: {
              location: 'LOCATION-1',
              text: 'Hello World',
              title: 'Lorem Ipsum',
              myField: 'this',
              otherField: 'another',
            },
            rank: expect.any(Number),
            type: 'my-type',
          },
        ]);
      },
      60_000,
    );

    it.each(databases.eachSupportedId())(
      'query without term and filter by field, %p',
      async databaseId => {
        const { store } = await createStore(databaseId);

        await store.transaction(async tx => {
          await store.prepareInsert(tx);
          await store.insertDocuments(tx, 'my-type', [
            {
              title: 'Lorem Ipsum',
              text: 'Hello World',
              myField: 'this',
              location: 'LOCATION-1',
            } as unknown as IndexableDocument,
            {
              title: 'Dolor sit amet',
              text: 'Hello World',
              myField: 'this',
              location: 'LOCATION-1',
            } as unknown as IndexableDocument,
          ]);
          await store.completeInsert(tx, 'my-type');
        });

        const rows = await store.transaction(tx =>
          store.query(tx, {
            fields: { myField: 'this' },
          }),
        );

        expect(rows).toEqual([
          {
            document: {
              title: 'Lorem Ipsum',
              text: 'Hello World',
              myField: 'this',
              location: 'LOCATION-1',
            } as unknown as IndexableDocument,
            rank: expect.any(Number),
            type: 'my-type',
          },
          {
            document: {
              title: 'Dolor sit amet',
              text: 'Hello World',
              myField: 'this',
              location: 'LOCATION-1',
            } as unknown as IndexableDocument,
            rank: expect.any(Number),
            type: 'my-type',
          },
        ]);
      },
      60_000,
    );
  });
});
