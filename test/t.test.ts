import fs from 'fs';

import { createMockStore } from '@graphql-tools/mock';
import { addResolversToSchema } from '@graphql-tools/schema';
import { GraphQLSchema, graphql } from 'graphql';
import { toGlobalId } from 'graphql-relay';

import Store from '../src/store';

const typeDefs = fs.readFileSync(`${__dirname}/swapi.graphql`, 'utf-8');

describe('testsing', () => {
  it('s', () => {
    const schema = require('@graphql-tools/schema').makeExecutableSchema({
      typeDefs,
    });

    const myStore = new Store(schema);

    myStore.define('Film', {
      generators: (faker) => ({
        producers: [faker.name.firstName(), faker.name.firstName()],
        title: faker.name.title(),
        episodeID: 5,
      }),
      examples: [
        {
          $id: '1',
          episodeID: 4,
        },
        {
          $id: '2',
          episodeID: 5,
        },
      ],
    });

    console.log(myStore.get('Film', '1', 'releaseDate'));
    console.log(myStore.get('Film', '1'));

    // console.log(myStore.get('Film', '3'));
    // console.log(myStore.getAll('Film'));

    // const store = createMockStore({
    //   schema,
    //   mocks: {},
    // });

    // store.get({
    //   typeName: 'Film',
    //   key: '1',
    //   defaultValue: { title: 'A title' },
    // });
    // console.log(
    //   store.get({
    //     typeName: 'Film',
    //   }),
    // );

    // console.log(store.store);

    // console.log(store.generateFieldValue('Film', 'title'));

    // console.log(myStore.get('Film', 1));

    // addResolversToSchema({
    //   schema,
    //   resolvers: {
    //     String: () => console.log('herere') || '',
    //   },
    // });
  });
});
