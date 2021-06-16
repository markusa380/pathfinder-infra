import * as cdk from "@aws-cdk/core";
import * as ecs from "@aws-cdk/aws-ecs";
import * as ec2 from "@aws-cdk/aws-ec2";
import * as efs from "@aws-cdk/aws-efs";
import * as elb from "@aws-cdk/aws-elasticloadbalancingv2";
import * as s3 from "@aws-cdk/aws-s3";
import * as logs from "@aws-cdk/aws-logs";
import * as autoscaling from "@aws-cdk/aws-autoscaling";
import * as r53 from "@aws-cdk/aws-route53";
import { CfnOutput, CfnParameter } from "@aws-cdk/core";
import { GatewayVpcEndpointAwsService } from "@aws-cdk/aws-ec2";
import * as iam from "@aws-cdk/aws-iam";
import * as lambda from "@aws-cdk/aws-lambda";
import * as events from "@aws-cdk/aws-events";
import * as targets from "@aws-cdk/aws-events-targets"
import * as fs from "fs";

export class PathfinderInfraStack extends cdk.Stack {
  constructor(scope: cdk.Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // ### CONSTANTS & INPUTS ### //

    const hostedZoneId = new CfnParameter(this, "hostedZoneId", {
      type: "String",
      description: "The ID of the hosted zone",
    });

    const hostedZoneName = new CfnParameter(this, "hostedZoneName", {
      type: "String",
      description: "The name of the hosted zone",
    });

    const defaultStartCron = "0 18 * * ? *"

    const startCron = new CfnParameter(this, "startCron", {
      type: "String",
      description: `A cron expression describing when to start the server infrastructure (using UTC timezone). Default: "${defaultStartCron}"`,
      default: defaultStartCron
    });

    const defaultStopCtron = "0 23 * * ? *"

    const stopCron = new CfnParameter(this, "stopCron", {
      type: "String",
      description: `A cron expression describing when to stop the server infrastructure (using UTC timezone). Default: "${defaultStopCtron}"`,
      default: defaultStopCtron
    });

    const steamUser = new CfnParameter(this, "steamUser", {
      type: "String",
      description: "Username of the steam user used to download and host the Arma server"
    });

    const steamPassword = new CfnParameter(this, "steamPassword", {
      type: "String",
      description: "Password of the steam user"
    });

    const defaultArmaServerDiskSizeGb = 70

    const armaServerDiskSizeGiB = new CfnParameter(this, "armaServerDiskSizeGiB", {
      type: "Number",
      description: `Disk size of the Arma server in GiB. Default: ${defaultArmaServerDiskSizeGb}`,
      default: defaultArmaServerDiskSizeGb
    });

    const startTime = `cron(${startCron.valueAsString})`;
    const stopTime = `cron(${stopCron.valueAsString})`;

    const teamspeakCpu = 256;
    const teamspeakMem = 1024;

    const armaCpu = 2048;
    const armaMem = 4096;

    const UDP = {
      ecsProtocol: ecs.Protocol.UDP,
      elbProtocol: elb.Protocol.UDP,
      ec2Protocol: ec2.Protocol.UDP,
    };

    const TCP = {
      ecsProtocol: ecs.Protocol.TCP,
      elbProtocol: elb.Protocol.TCP,
      ec2Protocol: ec2.Protocol.TCP,
    };

    const teamspeakPorts = [
      {
        port: 10011,
        protocol: TCP,
      },
      {
        port: 30033,
        protocol: TCP,
      },
      {
        port: 9987,
        protocol: UDP,
      },
    ];

    const armaPorts = [
      {
        port: 2302,
        protocol: UDP,
      },
      {
        port: 2303,
        protocol: UDP,
      },
      {
        port: 2304,
        protocol: UDP,
      },
      {
        port: 2305,
        protocol: UDP,
      },
      {
        port: 2306,
        protocol: UDP,
      },
    ];

    const vpc = new ec2.Vpc(this, "MainVpc", {
      natGateways: 0 // NAT Gateways do be expensive tho
    });

    // Required so downloading mods on boot will not lead to costs
    const gatewayEndpoint = vpc.addGatewayEndpoint("GatewayVpcEndpoint", {
      service: GatewayVpcEndpointAwsService.S3,
    });

    const mainCluster = new ecs.Cluster(this, "MainCluster", {
      vpc: vpc,
    });

    // ### SECURITY GROUPS ### //

    const teamspeakSecurityGroup = new ec2.SecurityGroup(this, "TeamspeakSg", {
      vpc: vpc,
      allowAllOutbound: true,
    });

    const teamspeakPersistenceFsSg = new ec2.SecurityGroup(
      this,
      "TeamspeakPersistenceFsSg",
      {
        vpc: vpc,
        allowAllOutbound: true,
      }
    );

    const armaSecurityGroup = new ec2.SecurityGroup(this, "ArmaSg", {
      vpc: vpc,
      allowAllOutbound: true,
    });

    teamspeakPorts.forEach((forwarding) => {
      teamspeakSecurityGroup.addIngressRule(
        ec2.Peer.anyIpv4(),
        PathfinderInfraStack.port(
          forwarding.protocol.ec2Protocol,
          forwarding.port
        ),
        "Access for clients of TeamSpeak"
      );
    });

    teamspeakPersistenceFsSg.addIngressRule(
      teamspeakSecurityGroup,
      ec2.Port.allTraffic(),
      "Access for Teamspeak to persistence volume"
    );

    armaPorts.forEach((forwarding) => {
      armaSecurityGroup.addIngressRule(
        ec2.Peer.anyIpv4(), // TODO: Only LB
        PathfinderInfraStack.port(
          forwarding.protocol.ec2Protocol,
          forwarding.port
        ),
        "Access for clients of Arma"
      );
    });

    // ### S3 BUCKETS ### //

    const dataBucket = new s3.Bucket(this, "ArmaDataBucket", {
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const missionsBucket = new s3.Bucket(this, "ArmaMissionsBucket", {
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const modsBucket = new s3.Bucket(this, "ArmaModsBucket", {
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // ### ROUTE 53 ### //

    r53.HostedZone.fromHostedZoneId

    // The domain and it's hosted zone already need to exist
    const hostedZone = r53.HostedZone.fromHostedZoneAttributes(this, 'HostedZone', {
      hostedZoneId: hostedZoneId.valueAsString,
      zoneName: hostedZoneName.valueAsString
    });

    const tsRecord = new r53.ARecord(this, "TeamspeakRecord", {
      zone: hostedZone,
      target: r53.RecordTarget.fromIpAddresses("0.0.0.0"),
      ttl: cdk.Duration.minutes(1),
      recordName: "ts"
    });

    const armaRecord = new r53.ARecord(this, "ArmaRecord", {
      zone: hostedZone,
      target: r53.RecordTarget.fromIpAddresses("0.0.0.0"),
      ttl: cdk.Duration.minutes(1),
      recordName: "arma"
    });

    // ### TEAMSPEAK SERVICE ### //

    const teamspeakPersistenceFs = new efs.FileSystem(
      this,
      "TeamspeakPersistenceFs",
      {
        vpc: vpc,
        securityGroup: teamspeakPersistenceFsSg,
        removalPolicy: cdk.RemovalPolicy.DESTROY
      }
    );

    const teamspeakPersistenceVolume: ecs.Volume = {
      name: "TeamspeakPersistence",
      efsVolumeConfiguration: {
        fileSystemId: teamspeakPersistenceFs.fileSystemId,
        rootDirectory: "/",
      },
    };

    const teamspeakTaskDefinition = new ecs.FargateTaskDefinition(
      this,
      "TeamspeakTask",
      {
        cpu: teamspeakCpu,
        memoryLimitMiB: teamspeakMem,
      }
    );

    teamspeakTaskDefinition.addVolume(teamspeakPersistenceVolume);

    const teamspeakTaskContainer = teamspeakTaskDefinition.addContainer(
      "TeamspeakContainer",
      {
        image: ecs.ContainerImage.fromRegistry("teamspeak"),
        memoryLimitMiB: teamspeakMem,
        environment: {
          TS3SERVER_LICENSE: "accept",
        },
        logging: ecs.AwsLogDriver.awsLogs({
          streamPrefix: "Teamspeak",
          logRetention: logs.RetentionDays.ONE_DAY,
        }),
        portMappings: teamspeakPorts.map((element) => {
          return {
            containerPort: element.port,
            hostPort: element.port,
            protocol: element.protocol.ecsProtocol,
          };
        })
        // TODO: Healthcheck command?
      }
    );

    teamspeakTaskContainer.addMountPoints({
      sourceVolume: teamspeakPersistenceVolume.name,
      containerPath: "/var/ts3server/",
      readOnly: false,
    });

    const teamspeakService = new ecs.FargateService(this, "TeamspeakService", {
      taskDefinition: teamspeakTaskDefinition,
      cluster: mainCluster,
      securityGroups: [teamspeakSecurityGroup],
      maxHealthyPercent: 100,
      minHealthyPercent: 0,
      assignPublicIp: true
    });

    // Autoscaling

    const teamspeakScaling = teamspeakService.autoScaleTaskCount({
      maxCapacity: 1,
      minCapacity: 0,
    });

    teamspeakScaling.scaleOnSchedule("TeamspeakAutoscaleOnSchedule", {
      schedule: autoscaling.Schedule.expression(startTime),
      minCapacity: 1,
      maxCapacity: 1,
    });

    teamspeakScaling.scaleOnSchedule("TeamspeakAutoscaleOffSchedule", {
      schedule: autoscaling.Schedule.expression(stopTime),
      minCapacity: 0,
      maxCapacity: 0,
    });

    // ### ARMA SERVICE ### //

    const armaTaskDefinition = new ecs.FargateTaskDefinition(this, "ArmaTask", {
      cpu: armaCpu,
      memoryLimitMiB: armaMem,
    });

    dataBucket.grantRead(armaTaskDefinition.taskRole);
    missionsBucket.grantRead(armaTaskDefinition.taskRole);
    modsBucket.grantRead(armaTaskDefinition.taskRole);

    const armaPortMappings = armaPorts.map((element) => {
      return {
        containerPort: element.port,
        hostPort: element.port,
        protocol: element.protocol.ecsProtocol,
      };
    });

    const armaTaskContainer = armaTaskDefinition.addContainer("ArmaContainer", {
      image: ecs.ContainerImage.fromRegistry(
        "markusa380/arma3server:release-39"
      ),
      memoryLimitMiB: armaMem,
      environment: {
        STEAM_USER: steamUser.valueAsString,
        STEAM_PASSWORD: steamPassword.valueAsString,
        DATA_BUCKET: dataBucket.bucketName,
        MISSIONS_BUCKET: missionsBucket.bucketName,
        MODS_BUCKET: modsBucket.bucketName
      },
      logging: ecs.AwsLogDriver.awsLogs({
        streamPrefix: "Arma",
        logRetention: logs.RetentionDays.ONE_DAY,
      }),
      portMappings: armaPortMappings,
    });

    const armaService = new ecs.FargateService(this, "ArmaService", {
      taskDefinition: armaTaskDefinition,
      cluster: mainCluster,
      securityGroups: [armaSecurityGroup],
      maxHealthyPercent: 200,
      minHealthyPercent: 0,
      assignPublicIp: true
    });

    // Autoscaling
    const armaScaling = armaService.autoScaleTaskCount({
      maxCapacity: 1,
      minCapacity: 0,
    });

    armaScaling.scaleOnSchedule("ArmaAutoscaleOnSchedule", {
      schedule: autoscaling.Schedule.expression(startTime),
      minCapacity: 1,
      maxCapacity: 1,
    });

    armaScaling.scaleOnSchedule("ArmaAutoscaleOffSchedule", {
      schedule: autoscaling.Schedule.expression(stopTime),
      minCapacity: 0,
      maxCapacity: 0,
    });

    // ### DNS RECORD UPDATER ### //

    const updateRecordsLambda = new lambda.Function(this, 'UpdateDnsRecordsLambda', {
      code: new lambda.InlineCode(fs.readFileSync('update-dns-records.py', { encoding: 'utf-8' })),
      handler: 'index.main',
      timeout: cdk.Duration.seconds(30),
      runtime: lambda.Runtime.PYTHON_3_6,
      environment: {
        HOSTED_ZONE_NAME: hostedZoneName.valueAsString,
        HOSTED_ZONE_ID: hostedZoneId.valueAsString,
        CLUSTER_ARN: mainCluster.clusterArn,
        ARMA_SERVICE_NAME: armaService.serviceName,
        TEAMSPEAK_SERVICE_NAME: teamspeakService.serviceName,
      },
      retryAttempts: 0,
      logRetention: logs.RetentionDays.ONE_DAY
    });

    updateRecordsLambda.addToRolePolicy(
      new iam.PolicyStatement({
        actions: [
          "route53:Get*",
          "route53:List*",
          "route53:ChangeResourceRecordSets",
          "ecs:List*",
          "ecs:Get*",
          "ecs:Describe*",
          "ec2:DescribeNetworkInterfaces"
        ],
        effect: iam.Effect.ALLOW,
        resources: ["*"] // TODO: Make it more specific
      })
    );

    const updateRecordsRule = new events.Rule(this, 'UpdateRecordsRule', {
      schedule: events.Schedule.expression('rate(1 minute)')
    });

    updateRecordsRule.addTarget(new targets.LambdaFunction(updateRecordsLambda));

    // ### OUTPUTS ### //

    const dataBucketNameOutput = new CfnOutput(this, "DataBucketNameOutput", {
      value: dataBucket.bucketName,
      description: "Data bucket",
    });

    const missionsBucketNameOutput = new CfnOutput(
      this,
      "MissionsBucketNameOutput",
      {
        value: missionsBucket.bucketName,
        description: "Missions bucket",
      }
    );

    const modsBucketNameOutput = new CfnOutput(
      this,
      "ModsBucketNameOutput",
      {
        value: modsBucket.bucketName,
        description: "Mods bucket"
      }
    )

    this.ephemeralStorageHack(armaTaskDefinition, armaServerDiskSizeGiB.valueAsNumber);
  }

  // ### UTILITY METHODS ### //

  static port(protocol: ec2.Protocol, port: number): ec2.Port {
    return new ec2.Port({
      protocol: protocol,
      fromPort: port,
      toPort: port,
      stringRepresentation: port + "@" + protocol,
    });
  }

  ephemeralStorageHack(taskDef: ecs.FargateTaskDefinition, sizeGiB: number): void {
    const props = taskDef.node.defaultChild as ecs.CfnTaskDefinition;
    props.addPropertyOverride("EphemeralStorage", {
      SizeInGiB: sizeGiB,
    });
  }
}
