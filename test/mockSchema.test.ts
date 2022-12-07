import fs from 'fs';

import { mockServer } from '@graphql-tools/mock';
import { GraphQLSchema, graphql } from 'graphql';
import { toGlobalId } from 'graphql-relay';

import { addMocksToSchema } from '../src/mockSchema';
import { globalIdMock } from '../src/relay';
import { connection, itemById, name, related } from '../src/resolvers';
import MockStore from '../src/store';

const typeDefs = fs.readFileSync(`${__dirname}/swapi.graphql`, 'utf-8');

const gql = (template: TemplateStringsArray, ...substitutions: any[]) =>
  String.raw(template, substitutions);

// const staticMocks: MockTypeMap = {};

describe('mock schema', () => {
  let mocks: MockStore;

  async function run(schema: GraphQLSchema, query: string, variables?: any) {
    const result = await graphql({
      schema,
      source: query,
      rootValue: {},
      contextValue: { mocks },
      variableValues: variables,
    });
    if (result.errors?.length) {
      throw new Error(`Request failed: ${result.errors[0].message}`);
    }
    return result.data!;
  }

  function getStore() {
    const store = new MockStore(typeDefs, { connectionLength: 10 });

    // store.define(staticMocks);

    return store;
  }

  beforeEach(() => {
    mocks = getStore();
  });

  it.only('should resolve', async () => {
    const data = await run(
      addMocksToSchema({
        store: mocks,
        // resolvers: {
        //   ID: globalIdMock,
        // },
      }),
      gql`
        query {
          allFilms {
            films {
              id
              title
              episodeID
            }
            totalCount
          }
        }
      `,
    );

    expect({ data }).toMatchInlineSnapshot(`
Object {
  "data": Object {
    "allFilms": Object {
      "films": Array [
        Object {
          "episodeID": 42,
          "id": "RmlsbTpGaWxtOjQ=",
          "title": "circuit",
        },
        Object {
          "episodeID": 2,
          "id": "RmlsbTpGaWxtOjY=",
          "title": "Mississippi",
        },
      ],
      "totalCount": 10,
    },
  },
}
`);
  });

  it('should resolve with args', async () => {
    const data = await run(
      mocks.mockedSchema,
      gql`
        query {
          person(id: 1) {
            name
          }
        }
      `,
    );

    expect({ data }).toMatchInlineSnapshot(`
Object {
  "data": Object {
    "person": Object {
      "name": "circuit",
    },
  },
}
`);
  });

  describe('sampling', () => {
    it('should use existing data', async () => {
      mocks.addExamples('Person', [
        { $id: 'p1', name: 'Luke Skywalker' },
        { $id: 'p2', name: 'Leia Skywalker' },
        { $id: 'p3', name: 'Han Solo' },
      ]);

      mocks.addExamples('Film', [
        { $id: 'f1', title: 'A New Hope', episodeID: 4 },
        { $id: 'f2', title: 'The Empire Strikes Back', episodeID: 5 },
      ]);

      const data = await run(
        mocks.mockedSchema,
        gql`
          query {
            allFilms {
              films {
                id
                title
                episodeID
                characters {
                  name
                }
              }
            }
          }
        `,
      );

      expect({ data }).toMatchInlineSnapshot(`
Object {
  "data": Object {
    "allFilms": Object {
      "films": Array [
        Object {
          "characters": Array [
            Object {
              "name": "Luke Skywalker",
            },
            Object {
              "name": "Leia Skywalker",
            },
          ],
          "episodeID": 4,
          "id": "RmlsbTpmMQ==",
          "title": "A New Hope",
        },
        Object {
          "characters": Array [
            Object {
              "name": "Leia Skywalker",
            },
            Object {
              "name": "Han Solo",
            },
          ],
          "episodeID": 5,
          "id": "RmlsbTpmMg==",
          "title": "The Empire Strikes Back",
        },
      ],
    },
  },
}
`);
    });

    it('should not repeat list data', async () => {
      mocks.addExamples('Person', [{ $id: 'p1', name: 'Luke Skywalker' }]);

      mocks.addExamples('Film', [
        { $id: 'f1', title: 'A New Hope', episodeID: 4 },
      ]);

      const data = await run(
        mocks.mockedSchema,
        gql`
          query {
            allFilms {
              films {
                id
                title
                episodeID
                characters {
                  name
                }
              }
            }
          }
        `,
      );

      expect({ data }).toMatchInlineSnapshot(`
Object {
  "data": Object {
    "allFilms": Object {
      "films": Array [
        Object {
          "characters": Array [
            Object {
              "name": "Luke Skywalker",
            },
            Object {
              "name": "matrix",
            },
          ],
          "episodeID": 4,
          "id": "RmlsbTpmMQ==",
          "title": "A New Hope",
        },
        Object {
          "characters": Array [
            Object {
              "name": "Luke Skywalker",
            },
            Object {
              "name": "Designer",
            },
          ],
          "episodeID": 28,
          "id": "RmlsbTo1OGZhNjQ3ZS05YTE5LTRmZWUtYWRkYi1mYjg0OWNjZjNmMmQ=",
          "title": "initiative",
        },
      ],
    },
  },
}
`);
    });
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

    expect(result.allFilms.films).toEqual([{ id: 'yolo' }, { id: 'yolo' }]);
  });

  it('should resolve using configured mocks', async () => {
    mocks.mock({
      Film: () => ({
        characters: () => [{}, {}, {}],
      }),
      Person: () => ({ name }),
    });

    const result = await run(
      addMocksToSchema({ store: mocks }),
      gql`
        query {
          film {
            characters {
              name
            }
          }
        }
      `,
    );

    expect(result.film.characters).toMatchInlineSnapshot(`
      Array [
        Object {
          "name": "Crystal Ziemann",
        },
        Object {
          "name": "Wilma Swift",
        },
        Object {
          "name": "Brent Volkman DDS",
        },
      ]
    `);
  });

  it('can access source from context', async () => {
    mocks.mock({
      Root: () => ({
        person: mocks.get('Person', 'p1'),
      }),
      Person: () => ({
        name() {
          return this.$name;
        },
      }),
    });

    mocks.addExample('Person', {
      $id: 'p1',
      $name: 'secret name',
    });

    const { person } = await run(
      mocks.mockedSchema,
      gql`
        query {
          person {
            name
          }
        }
      `,
    );

    expect(person.name).toEqual('secret name');
  });

  it('should generate real connections', async () => {
    mocks.define('Person', {
      generators: (faker) => ({
        name: faker.name.findName(),
      }),
    });

    const data = await run(
      mocks.mockedSchema,
      gql`
        query {
          allPeople(first: 5) {
            edges {
              node {
                name
              }
            }
            totalCount
            pageInfo {
              hasNextPage
            }
          }
        }
      `,
    );

    expect(data.allPeople).toMatchInlineSnapshot(`
Object {
  "edges": Array [
    Object {
      "node": Object {
        "name": "Rene Reilly",
      },
    },
    Object {
      "node": Object {
        "name": "Garry Feil",
      },
    },
    Object {
      "node": Object {
        "name": "Amy Boyer",
      },
    },
    Object {
      "node": Object {
        "name": "Jennie Bartell III",
      },
    },
    Object {
      "node": Object {
        "name": "Barry Runolfsson",
      },
    },
  ],
  "pageInfo": Object {
    "hasNextPage": true,
  },
  "totalCount": 10,
}
`);
  });

  it('should resolve to examples', async () => {
    // mocks.define('Root', () => ({
    //   allFilms: () => ({
    //     films: () => mocks.getAll('Film'),
    //   }),
    // }));

    mocks.define('Film', {
      generators: (faker) => ({
        director: faker.name.findName(),
      }),
    });

    mocks.addExamples('Film', [
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
              director
            }
          }
        }
      `,
    );

    expect(result.allFilms.films).toMatchInlineSnapshot(`
Array [
  Object {
    "director": "Betsy Zemlak",
    "episodeID": 4,
    "id": "RmlsbTox",
    "title": "A new Hope",
  },
  Object {
    "director": "Hazel Pfannerstill",
    "episodeID": 8,
    "id": "RmlsbToy",
    "title": "The Last Jedi",
  },
]
`);
  });

  it('should default mock node()', async () => {
    mocks.addExamples('Film', [
      {
        $id: '1',
        title: 'A new Hope',
        episodeID: 4,
      },
    ]);

    const data = await run(
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

    expect({ data }).toMatchInlineSnapshot(`
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
    const speciesQuery = gql`
      query {
        species(id: "${toGlobalId('Species', 's1')}") {
          name
          people {
            name
            species {
              name
            }
          }
        }
      }
    `;

    it('should find related items when configured', async () => {
      mocks.define('Species', {
        generators: (faker, db) => ({
          people: db.related(),
        }),
        examples: [
          {
            $id: 's1',
            name: 'Human',
          },
        ],
      });

      mocks.define('Person', {
        // generators: (faker) => ({
        //   species: db.related(''),
        // }),
        examples: [
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
        ],
      });

      mocks.resolvers({
        Root: () => ({
          species: itemById(),
        }),
        Species: () => ({
          people: related({
            idFieldName: '$id',
            relatedFieldName: 'species',
          }),
        }),
        Person: () => ({
          species: related({
            idFieldName: 'species',
            relatedFieldName: '$id',
          }),
        }),
      });

      const data = await run(mocks.mockedSchema, speciesQuery);

      expect(data.species).toEqual({
        name: 'Human',
        people: [
          { name: 'Luke Skywalker', species: { name: 'Human' } },
          { name: 'Leia Skywalker', species: { name: 'Human' } },
        ],
      });
    });

    it('should resolve connections ', async () => {
      mocks.addExample('Species', {
        $id: 's1',
        name: 'Human',
      });

      mocks.addExamples('Person', [
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

      mocks.mock({
        Species: () => ({
          personConnection: connection({
            idFieldName: '$id',
            relatedFieldName: 'species',
          }),
        }),
      });

      const data = await run(
        mocks.mockedSchema,
        gql`
          query {
            node(id: "${toGlobalId('Species', 's1')}") {
              ... on Species {
                name
                personConnection {
                  edges {
                    node {
                      name
                    }
                  }
                }
              }
            }
          }
        `,
      );

      expect(data.node).toEqual({
        name: 'Human',
        personConnection: {
          edges: [
            { node: { name: 'Luke Skywalker' } },
            { node: { name: 'Leia Skywalker' } },
          ],
        },
      });
    });

    it('should automatically link FKs', async () => {
      const resolvers = {
        Root: {
          species: itemById(),
        },
      };

      mocks.addExample('Species', {
        $id: 's1',
        name: 'Human',
      });

      mocks.addExamples('Person', [
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

      const data = await run(
        addMocksToSchema({ store: mocks, resolvers }),
        speciesQuery,
      );

      expect(data.species).toEqual({
        name: 'Human',
        people: [
          { name: 'Luke Skywalker', species: { name: 'Human' } },
          { name: 'Leia Skywalker', species: { name: 'Human' } },
        ],
      });
    });

    it.only('should automatically link parent -> child with a backref', async () => {
      const resolvers = {
        Root: {
          species: itemById(),
        },
      };
      mocks.addExamples('Species', [
        {
          $id: 's1',
          name: 'Human',
          people: ['p1', 'p2'],
        },
        {
          $id: 's2',
          name: 'Hutt',
          people: ['p3'],
        },
      ]);

      mocks.addExamples('Person', [
        {
          $id: 'p1',
          name: 'Luke Skywalker',
        },
        {
          $id: 'p2',
          name: 'Leia Skywalker',
        },
        {
          $id: 'p3',
          name: 'Jabba',
        },
      ]);

      const data = await run(
        addMocksToSchema({ store: mocks, resolvers }),
        speciesQuery,
      );

      expect(data.species).toEqual({
        name: 'Human',
        people: [
          { name: 'Luke Skywalker', species: { name: 'Human' } },
          { name: 'Leia Skywalker', species: { name: 'Human' } },
        ],
      });
    });

    it.only('should automatically link explicit FKs', async () => {
      const resolvers = {
        Root: {
          species: itemById(),
        },
      };

      mocks.addExample('Species', {
        $id: 's1',
        name: 'Human',
      });

      mocks.addExamples('Person', [
        {
          $id: 'p1',
          $speciesId: 's1',
          name: 'Luke Skywalker',
        },
        {
          $id: 'p2',
          $speciesId: 's1',
          name: 'Leia Skywalker',
        },
      ]);

      const data = await run(
        addMocksToSchema({ store: mocks, resolvers }),
        speciesQuery,
      );
      console.log(data);
      expect(data.species).toEqual({
        name: 'Human',
        people: [
          { name: 'Luke Skywalker', species: { name: 'Human' } },
          { name: 'Leia Skywalker', species: { name: 'Human' } },
        ],
      });
    });

    it('should automatically link connections', async () => {
      mocks.addExample('Species', {
        $id: 's1',
        name: 'Human',
      });

      mocks.addExamples('Person', [
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

      const data = await run(
        mocks.mockedSchema,
        gql`
          query {
            node(id: "${toGlobalId('Species', 's1')}") {
              ... on Species {
                name
                personConnection {
                  edges {
                    node {
                      name
                    }
                  }
                  pageInfo {
                    hasNextPage
                  }
                }
              }
            }
          }
        `,
      );
      expect(data.node).toEqual({
        name: 'Human',
        personConnection: {
          edges: [
            { node: { name: 'Luke Skywalker' } },
            { node: { name: 'Leia Skywalker' } },
          ],
          pageInfo: {
            hasNextPage: false,
          },
        },
      });
    });

    it('should automatically link using explicit FK', async () => {
      mocks.addExample('Species', {
        $id: 's1',
        name: 'Human',
      });

      mocks.addExamples('Person', [
        {
          $id: 'p1',
          $speciesId: 's1',
          name: 'Luke Skywalker',
        },
        {
          $id: 'p2',
          $speciesId: 's1',
          name: 'Leia Skywalker',
        },
      ]);

      const data = await run(
        mocks.mockedSchema,
        gql`
          query {
            node(id: "${toGlobalId('Species', 's1')}") {
              ... on Species {
                name
                personConnection {
                  edges {
                    node {
                      name
                    }
                  }
                  pageInfo {
                    hasNextPage
                  }
                }
              }
            }
          }
        `,
      );
      expect(data.node).toEqual({
        name: 'Human',
        personConnection: {
          edges: [
            { node: { name: 'Luke Skywalker' } },
            { node: { name: 'Leia Skywalker' } },
          ],
          pageInfo: {
            hasNextPage: false,
          },
        },
      });
    });

    it('should automatically paginate connections', async () => {
      mocks.addExample('Species', {
        $id: 's1',
        name: 'Human',
      });

      mocks.addExamples('Person', [
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

      const data = await run(
        mocks.mockedSchema,
        gql`
          query {
            node(id: "${toGlobalId('Species', 's1')}") {
              ... on Species {
                name
                personConnection(first: 1) {
                  edges {
                    node {
                      name
                    }
                  }
                  pageInfo {
                    hasNextPage
                  }
                }
              }
            }
          }
        `,
      );
      expect(data.node).toEqual({
        name: 'Human',
        personConnection: {
          edges: [{ node: { name: 'Luke Skywalker' } }],
          pageInfo: {
            hasNextPage: true,
          },
        },
      });
    });
  });
});
