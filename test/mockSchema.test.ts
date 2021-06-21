import { GraphQLSchema, graphql } from 'graphql';
import Mocks, { MockTypeMap } from '../src';

import fs from 'fs';
import { makeExecutableSchema } from '@graphql-tools/schema';
import { toGlobalId } from 'graphql-relay';

const typeDefs = fs.readFileSync(`${__dirname}/swapi.graphql`, 'utf-8');

const gql = (template: TemplateStringsArray, ...substitutions: any[]) =>
  String.raw(template, substitutions);

const staticMocks: MockTypeMap = {
  Int: () => 42,
  Float: () => 3.14,
  String: (_obj, _arg, _ctx, info) => info.fieldName,
};

describe('mock schema', () => {
  let schema: GraphQLSchema;
  let mocks: Mocks;

  function run(s: GraphQLSchema, query: string, variables?: any) {
    return graphql(s, query, {}, variables);
  }

  function getStore() {
    const store = new Mocks(schema);

    store.mock(staticMocks);

    return store;
  }

  beforeEach(() => {
    schema = makeExecutableSchema({ typeDefs });
    mocks = getStore();
  });

  it('should resolve', async () => {
    const result = await run(
      mocks.mockedSchema,
      gql`
        query {
          allFilms {
            films {
              id
              title
              episodeID
            }
          }
        }
      `,
    );

    expect(result).toMatchInlineSnapshot(`
Object {
  "data": Object {
    "allFilms": Object {
      "films": Array [
        Object {
          "episodeID": 42,
          "id": "RmlsbTo0MWY2ZWY2ZC0wMjJjLTRhMDYtYjA4Yy1jNWM3ZDFkMzc4MGI=",
          "title": "title",
        },
        Object {
          "episodeID": 42,
          "id": "RmlsbTphNDRjZGZiNS0yMWRjLTQyMWEtYTkyZi1kZDRkM2NhOTU1Zjg=",
          "title": "title",
        },
      ],
    },
  },
}
`);
  });

  it('should handle global id mocks', async () => {
    mocks.mock('Film', () => ({
      id: 'yolo',
    }));

    const result = await run(
      mocks.mockedSchema,
      gql`
        query {
          allFilms {
            films {
              id
            }
          }
        }
      `,
    );

    expect(result.data!.allFilms.films).toEqual([
      { id: 'yolo' },
      { id: 'yolo' },
    ]);
  });

  it('should resolve to examples', async () => {
    mocks.mock('Root', () => ({
      allFilms: () => ({
        films: () => mocks.getAll('Film'),
      }),
    }));

    mocks.addMany('Film', [
      {
        $id: '1',
        title: 'A new Hope',
        episodeID: 4,
      },
      {
        $id: '2',
        title: 'The Last Jedi',
        episodeID: 8,
      },
    ]);

    const result = await run(
      mocks.mockedSchema,
      gql`
        query {
          allFilms {
            films {
              id
              title
              episodeID
            }
          }
        }
      `,
    );

    expect(result.data!.allFilms.films).toMatchInlineSnapshot(`
Array [
  Object {
    "episodeID": 4,
    "id": "RmlsbTox",
    "title": "A new Hope",
  },
  Object {
    "episodeID": 8,
    "id": "RmlsbToy",
    "title": "The Last Jedi",
  },
]
`);
  });

  it('should default mock node()', async () => {
    mocks.addMany('Film', [
      {
        $id: '1',
        title: 'A new Hope',
        episodeID: 4,
      },
    ]);

    const result = await run(
      mocks.mockedSchema,
      gql`
        query {
          node(id: "${toGlobalId('Film', '1')}") {
            id,
            ... on Film {
              title
            }
          }
        }
      `,
    );

    expect(result).toMatchInlineSnapshot(`
Object {
  "data": Object {
    "node": Object {
      "id": "RmlsbTox",
      "title": "A new Hope",
    },
  },
}
`);
  });

  describe('related fields', () => {
    it('should automatically link FKs', async () => {
      mocks.add('Species', {
        $id: 's1',
        name: 'Human',
      });

      mocks.addMany('Person', [
        {
          $id: 'p1',

          species: 's1',
          name: 'Luke Skywalker',
        },
        {
          $id: 'p2',

          species: 's1',
          name: 'Leia Skywalker',
        },
      ]);

      const result = await run(
        mocks.mockedSchema,
        gql`
          query {
            node(id: "${toGlobalId('Species', 's1')}") {
              ... on Species {
                name
                people {
                  name
                  species {
                    name
                  }
                }
              }
            }
          }
        `,
      );

      expect(result.data!.node).toMatchInlineSnapshot(`
Object {
  "name": "Human",
  "people": Array [
    Object {
      "name": "Luke Skywalker",
      "species": Object {
        "name": "Human",
      },
    },
    Object {
      "name": "Leia Skywalker",
      "species": Object {
        "name": "Human",
      },
    },
  ],
}
`);
    });
  });
});
