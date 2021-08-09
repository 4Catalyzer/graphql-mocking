import { GraphQLResolveInfo, getNullableType, isListType } from 'graphql';
import { Connection } from 'graphql-relay';
import { connectionFromArray } from 'graphql-relay/connection/arrayConnection';

import type { MockFieldResolver } from '.';
import {
  getConnectionNodeType,
  isConnectionType,
  resolveLocalOrGlobalId,
} from './relay';
import { Item, getNullableNamedType, valueOrRefId } from './utils';

export interface RelatedOptions {
  idFieldName?: string;
  relatedFieldName: string;
  filter?: (item: Item, args: any) => boolean;
}

/**
 * Create a filter function that can be used to implement a mock item
 * filter from a set of field resolver `args`.
 *
 * @param filters An object map of arg names to a filter function
 * @returns true if the item matches any of the arg filters
 */
export function filterByArgs<TArgs>(
  filters: { [K in keyof TArgs]?: (item: Item, args: TArgs) => boolean },
) {
  return (item: any, args: TArgs) => {
    return (Object.keys(filters) as Array<keyof TArgs>).reduce<boolean>(
      (filtered, argKey) =>
        filtered && (args[argKey] ? !!filters[argKey]?.(item, args) : true),
      true,
    );
  };
}

export function itemById(argName = 'id'): MockFieldResolver {
  return function resolveById({ [argName]: id }, { mocks }, { returnType }) {
    const localId = resolveLocalOrGlobalId(id);
    return mocks.get(getNullableNamedType(returnType).name, localId) ?? null;
  };
}

function assertId(
  id: any,
  methodName: string,
  field: string,
  src: any,
  info: GraphQLResolveInfo,
): asserts id is string {
  if (!id) {
    throw new Error(
      `${methodName} is missing an id (field: "${field}").

    source: ${JSON.stringify(src)}
    field: "${info.fieldName}"
    parentType: ${getNullableNamedType(info.parentType)}
    returnType: ${getNullableNamedType(info.returnType)}`,
    );
  }
}

/**
 * A factory method that returns a resolver for simple foreign key relationships in the graph.
 * Provide the `idFieldName` of a mock object and it will resolve a mock object for the return type
 * of the current field. `related` will also resolve lists of items in the case of a `GraphQLList` field.
 *
 * > Heads up! You don't need to explicitly configure unambiguous relationships, like the example below.
 * > The mocks will automatically try and resolve types based on inferred foreign keys for each mock type.
 *
 * ```ts
 * import { related } from '@4c/graphql-mocking';
 *
 * mocks.add('Organization', {
 *   $id: 'o1',
 *   name: 'Northwinds'
 * })
 * mocks.addMany('Orders', [
 *   { $id: 'or1', $customerId: 'c1', },
 *   { $id: 'or2', $customerId: 'c1', }
 * ])
 *
 * mocks.add('Customer', {
 *   $id: 'c1',
 *   name: 'Betsy Smith',
 *   organizationId: 'o1'
 * })
 *
 * mocks.mock('Customer', (obj) => ({
 *   orders: related({
 *     idFieldName: '$id',
 *     relatedFieldName: '$customerId'
 *   })
 *   organization: related({
 *     idFieldName: 'organizationId',
 *     relatedFieldName: '$id'
 *   })
 * }))
 *
 * //...
 *
 * const result = await graphql(mocks.mockedSchema, `
 *   query {
 *     allCustomers {
 *       name
 *       organization {
 *         name
 *       }
 *     }
 *   }
 * `)
 * ```
 *
 * @param options
 * @param options.idFieldName The mock-local field that contains the FK value
 * @param options.relatedFieldName The foreign key field on our list of items. This field must exist
 * on mock objects for the field return type.
 * @returns A `MockFieldResolver` that resolves to a related item or list of related items depending on the graphQL field type.
 */
export function related({
  idFieldName,
  relatedFieldName,
  filter,
}: RelatedOptions): MockFieldResolver {
  if (relatedFieldName == null)
    throw new Error(
      `related() relatedFieldName cannot be empty, please provide a field `,
    );

  return function relatedItemResolver(args, { mocks }, info) {
    const id = idFieldName ? this[idFieldName] : mocks.getId(this);

    assertId(
      id,
      'related()',
      idFieldName || `${mocks.idField} or $id`,
      this,
      info,
    );

    const otherType = getNullableNamedType(info.returnType);

    return isListType(getNullableType(info.returnType))
      ? mocks
          .getAll(otherType.name)
          .filter(
            (i: any) =>
              valueOrRefId(i[relatedFieldName]) === id &&
              (!filter || filter(i, args)),
          )
      : mocks.find(
          otherType.name,
          (i: any) =>
            valueOrRefId(i[relatedFieldName]) === id &&
            (!filter || filter(i, args)),
        );
  };
}

export interface ConnectionOptions extends RelatedOptions {
  nodeType?: string;
}

/**
 * Resolve a connection type to it's related items. Similar to `related` for a list
 * of items, but handles pagination according to the connection arguments, using `connectionFromArray`
 * from `graphql-relay`.
 * ```ts
 * import { connection } from '@4c/graphql-mocking';
 *
 * mocks.addMany('Orders', [
 *   { $id: 'or1', $customerId: 'c1', },
 *   { $id: 'or2', $customerId: 'c1', },
 *   { $id: 'or3', $customerId: 'c2', },
 * ])
 *
 * mocks.add('Customer', {
 *   $id: 'c1',
 *   name: 'Betsy Smith',
 * })
 *
 * mocks.mock('Customer', (obj) => ({
 *   orderConnection: connection({
 *     idFieldName:'$id',
 *     relatedFieldName: '$customerId'
 *   })
 * }))
 *
 * //...
 *
 * const result = await graphql(mocks.mockedSchema, `
 *   query {
 *     allCustomers {
 *       name
 *       orderConnection {
 *         edges {
 *           node { name }
 *         }
 *       }
 *     }
 *   }
 * `)
 * ```
 *
 * @param options The same set of options as `related` with the addition of `nodeType` for
 * cases where the type cannot be inferred correctly.
 * @returns A `MockFieldResolver` that resolves connection of related items
 */
export function connection({
  idFieldName,
  relatedFieldName,
  nodeType,
  filter,
}: ConnectionOptions): MockFieldResolver {
  if (relatedFieldName == null)
    throw new Error(
      `connection() relatedFieldName cannot be empty, please provide a field `,
    );

  return function connectionResolver(args, { mocks }, info) {
    const { parentType, returnType } = info;
    const id = idFieldName ? this[idFieldName] : mocks.getId(this);

    assertId(
      id,
      'connection()',
      idFieldName || `${mocks.idField} or $id`,
      this,
      info,
    );
    if (!id) {
      throw new Error(
        `connection() is missing an id (field: ${
          idFieldName || mocks.idField
        }) on source object: ${JSON.stringify(this)}`,
      );
    }

    const connType = getNullableNamedType(returnType);
    if (!isConnectionType(connType)) {
      throw new Error(
        `Invalid connection type: ${connType.name} on parent type: ${
          getNullableNamedType(parentType).name
        }`,
      );
    }

    nodeType = nodeType || getConnectionNodeType(connType).name;

    let nodes = mocks
      .getAll(nodeType)
      .filter((i: any) => valueOrRefId(i[relatedFieldName]) === id);

    if (filter) nodes = nodes.filter(filter);

    const conn = connectionFromArray(nodes, args) as Connection<Item> & {
      nodes?: Item[];
      totalCount?: number;
    };
    const fields = connType.getFields();

    if (fields.nodes) {
      conn.nodes = conn.edges.map((e) => e.node);
    }
    if (fields.totalCount) {
      conn.totalCount = nodes.length;
    }
    if (!fields.edges) {
      delete (conn as any).edges;
    }

    return conn;
  };
}

export const name: MockFieldResolver = (_, _ctx, info) =>
  info.faker.name.findName();
