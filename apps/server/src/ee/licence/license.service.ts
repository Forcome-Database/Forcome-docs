import { Injectable } from '@nestjs/common';

@Injectable()
export class LicenseService {
  isValidEELicense(_licenseKey: string): boolean {
    return true;
  }
}
