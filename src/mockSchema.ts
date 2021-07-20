import { MapperKind, mapSchema } from '@graphql-tools/utils';
import {
  GraphQLInterfaceType,
  GraphQLObjectType,
  GraphQLSchema,
  GraphQLTypeResolver,
  GraphQLUnionType,
  isSchema,
  isUnionType,
} from 'graphql';

import type Mocks from '.';
import { isRef } from './utils';

export interface MockOptions {
  schema: GraphQLSchema;
  store: Mocks;
}

export function addMocksToSchema({
  schema,
  store,
}: MockOptions): GraphQLSchema {
  if (!schema) {
    throw new Error('Must provide schema to mock');
  }
  if (!isSchema(schema)) {
    throw new Error('Value at "schema" must be of type GraphQLSchema');
  }

  const typeResolver: GraphQLTypeResolver<any, any> = (data) => {
    return schema.getType(
      isRef(data) ? data.$$ref.type : data.__typename,
    ) as GraphQLObjectType;
  };

  const schemaWithMocks = mapSchema(schema, {
    [MapperKind.OBJECT_FIELD]: (fieldConfig) => {
      return {
        ...fieldConfig,
        resolve: store.resolve.bind(store),
      };
    },
    [MapperKind.ABSTRACT_TYPE]: (type) => {
      if (isUnionType(type)) {
        return new GraphQLUnionType({
          ...type.toConfig(),
          resolveType: typeResolver,
        });
      }
      return new GraphQLInterfaceType({
        ...type.toConfig(),
        resolveType: typeResolver,
      });
    },
  });

  return schemaWithMocks;
}
