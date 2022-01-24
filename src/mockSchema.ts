import { addResolversToSchema } from '@graphql-tools/schema';
import {
  IAddResolversToSchemaOptions,
  MapperKind,
  mapSchema,
} from '@graphql-tools/utils';
import {
  GraphQLFieldResolver,
  GraphQLInterfaceType,
  GraphQLObjectType,
  GraphQLSchema,
  GraphQLTypeResolver,
  GraphQLUnionType,
  defaultFieldResolver,
  getNamedType,
  getNullableType,
  isListType,
  isSchema,
  isUnionType,
} from 'graphql';

import {
  getConnectionNodeType,
  hasNodeInterface,
  isConnectionType,
  nodeMock,
} from './relay';
import { connection, related } from './resolvers';
import type Mocks from './store';
import { isRef, isRootType } from './utils';

export interface MockOptions {
  // schema: GraphQLSchema;
  store: Mocks;
  resolvers?: IAddResolversToSchemaOptions['resolvers'];
}

export function addMocksToSchema({
  // schema,
  store,
  resolvers,
}: MockOptions): GraphQLSchema {
  const { schema } = store;
  // if (!schema) {
  //   throw new Error('Must provide schema to mock');
  // }
  // if (!isSchema(schema)) {
  //   throw new Error('Value at "schema" must be of type GraphQLSchema');
  // }

  // if (hasNodeInterface(schema)) {
  //   resolvers = resolvers
  //     ? { Node: nodeMock, ...resolvers }
  //     : { Node: nodeMock };
  // }

  const mockResolver: GraphQLFieldResolver<any, any> = (
    src,
    args,
    ctx,
    info,
  ) => {
    // ctx.mocks ||= store;
    const defaultResolvedValue = defaultFieldResolver(src, args, ctx, info);

    if (defaultResolvedValue !== undefined) {
      return defaultResolvedValue;
    }

    const { parentType } = info;
    const fieldType = getNullableType(info.returnType);

    let resolvedField;
    let resolvedParent = isRef(src) ? store.get(src) : src;

    if (isRootType(info.parentType, info.schema)) {
      resolvedParent = store.get(info.parentType.name, 'ROOT');
    }

    if (isListType(fieldType)) {
      const listType = getNamedType(fieldType);
      const fk = store.getRelatedKey(listType.name, parentType.name);
      if (fk) {
        return related({
          relatedFieldName: fk,
        }).apply(resolvedParent, [args, ctx, info]);
      }
    } else if (isConnectionType(fieldType)) {
      const nodeType = getConnectionNodeType(fieldType);
      const fk = store.getRelatedKey(nodeType.name, parentType.name);

      if (fk) {
        return connection({
          relatedFieldName: fk,
        }).apply(resolvedParent, [args, ctx, info]);
      }
    }

    resolvedField = resolvedParent[info.fieldName];

    if (resolvedParent[info.fieldName] === undefined)
      resolvedField = store.generateTypeFromMocks(
        parentType.name,
        store.getId(resolvedParent),
        info.fieldName,
      );

    ctx ||= {};
    ctx.mocks ||= store;

    //
    return typeof resolvedField === 'function'
      ? resolvedField.call(resolvedParent || src, args, ctx, info)
      : resolvedField;
  };

  const typeResolver: GraphQLTypeResolver<any, any> = (data) => {
    return schema.getType(
      isRef(data) ? data.$$ref.type : data.__typename,
    ) as GraphQLObjectType;
  };

  const schemaWithMocks = mapSchema(schema, {
    [MapperKind.OBJECT_FIELD]: (fieldConfig) => {
      return {
        ...fieldConfig,
        resolve: mockResolver,
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

  return resolvers
    ? addResolversToSchema({
        schema: schemaWithMocks,
        resolvers,
      })
    : schemaWithMocks;
}
