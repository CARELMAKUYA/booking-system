import { registerDecorator, ValidationOptions } from 'class-validator';
import { isDateOnly } from './domain';

/** Validates a `YYYY-MM-DD` calendar date. */
export function IsDateOnly(options?: ValidationOptions) {
  return (object: object, propertyName: string) =>
    registerDecorator({
      name: 'isDateOnly',
      target: object.constructor,
      propertyName,
      options: { message: `${propertyName} must be a date in YYYY-MM-DD format`, ...options },
      validator: { validate: (value: unknown) => isDateOnly(value) },
    });
}
