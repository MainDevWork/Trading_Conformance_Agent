-- Creates the database TradingConformance with one schema (a named group of tables) per layer: bronze, silver, gold.
-- Run once, connected to the SQL Server instance as an administrator.

-- The database compares text by its exact characters (collation Latin1_General_100_BIN2). JSE order and execution
-- IDs differ only in upper and lower case letters ("O0SnTxKEgvzy" and "O0SnTxKEgvzY" are different orders), and the
-- default SQL Server collation would treat them as equal. A side effect: table and column names must be typed in
-- the same case as they are created, which is lower case throughout.
IF DB_ID(N'TradingConformance') IS NULL
    CREATE DATABASE TradingConformance COLLATE Latin1_General_100_BIN2;
GO

-- Compatibility level 160 is SQL Server 2022. The scripts use commands added in that version: IGNORE NULLS,
-- the WINDOW clause and GENERATE_SERIES.
ALTER DATABASE TradingConformance SET COMPATIBILITY_LEVEL = 160;
GO

USE TradingConformance;
GO
IF SCHEMA_ID(N'bronze') IS NULL EXEC (N'CREATE SCHEMA bronze');
IF SCHEMA_ID(N'silver') IS NULL EXEC (N'CREATE SCHEMA silver');
IF SCHEMA_ID(N'gold') IS NULL EXEC (N'CREATE SCHEMA gold');
GO

-- Allow OPENROWSET, the command that 01_bronze_load_excel.sql uses to read the Excel files. It is off by default.
EXEC sp_configure N'show advanced options', 1;
RECONFIGURE;
EXEC sp_configure N'Ad Hoc Distributed Queries', 1;
RECONFIGURE;
GO

-- Let the Excel reader (Microsoft.ACE.OLEDB.16.0, from the Microsoft Access Database Engine 2016 Redistributable,
-- 64-bit) run inside the SQL Server process and accept the query text it is given.
EXEC master.dbo.sp_MSset_oledb_prop N'Microsoft.ACE.OLEDB.16.0', N'AllowInProcess', 1;
EXEC master.dbo.sp_MSset_oledb_prop N'Microsoft.ACE.OLEDB.16.0', N'DynamicParameters', 1;
GO
