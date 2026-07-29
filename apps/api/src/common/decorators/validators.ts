import { ValidationArguments, ValidationOptions, registerDecorator } from 'class-validator';
import { isAllocationMethod, isCurrencyCode, isWeightUnit } from '@bullion-ledger/shared';

export function IsWeightUnitValue(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string): void {
    registerDecorator({
      name: 'isWeightUnit',
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate(value: unknown): boolean {
          return isWeightUnit(value);
        },
        defaultMessage(args: ValidationArguments): string {
          return `${args.property} must be one of g | kg | troy_oz | qian`;
        },
      },
    });
  };
}

export function IsCurrencyCodeValue(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string): void {
    registerDecorator({
      name: 'isCurrencyCode',
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate(value: unknown): boolean {
          return isCurrencyCode(value);
        },
        defaultMessage(args: ValidationArguments): string {
          return `${args.property} must be a 3-letter uppercase ISO currency code`;
        },
      },
    });
  };
}

export function IsAllocationMethodValue(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string): void {
    registerDecorator({
      name: 'isAllocationMethod',
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate(value: unknown): boolean {
          return isAllocationMethod(value);
        },
        defaultMessage(args: ValidationArguments): string {
          return `${args.property} must be one of MANUAL | SUBTOTAL_PROPORTIONAL | WEIGHT_PROPORTIONAL | EQUAL`;
        },
      },
    });
  };
}
